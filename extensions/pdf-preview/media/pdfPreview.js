/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

/**
 * PDF Preview Webview Script
 * Uses PDF.js to render PDF documents in VS Code webview.
 *
 * Pages render lazily: a placeholder box sized to each page's real dimensions is
 * created up-front so scroll geometry and the page indicator are correct, and the
 * canvas + text layer are produced only when a page scrolls near the viewport
 * (IntersectionObserver). Far-offscreen pages are released to keep memory bounded.
 */
(async function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	// State
	let pdfDoc = null;
	let currentPage = 1;
	let scale = 1.0;

	/**
	 * Per-page render state, indexed by 1-based page number.
	 * @type {Array<{ num: number, container: HTMLElement, canvas: HTMLCanvasElement, page: any, baseViewport: { width: number, height: number }, textItems: any[] | null, rendered: boolean, renderTask: any }>}
	 */
	const pageStates = [];

	/** @type {IntersectionObserver | null} */
	let renderObserver = null;
	/** @type {IntersectionObserver | null} */
	let releaseObserver = null;

	// DOM Elements
	const viewer = document.getElementById('viewer');
	const loading = document.getElementById('loading');
	const pageInput = document.getElementById('page-input');
	const pageCount = document.getElementById('page-count');
	const zoomLevel = document.getElementById('zoom-level');
	const prevButton = document.getElementById('prev-page');
	const nextButton = document.getElementById('next-page');
	const zoomInButton = document.getElementById('zoom-in');
	const zoomOutButton = document.getElementById('zoom-out');
	const zoomFitButton = document.getElementById('zoom-fit');
	const extractTextButton = document.getElementById('extract-text');
	const extractOcrButton = document.getElementById('extract-ocr');
	const viewerContainer = document.getElementById('viewer-container');
	const findToggleButton = document.getElementById('find-toggle');
	const findBar = document.getElementById('find-bar');
	const findInput = document.getElementById('find-input');
	const findCount = document.getElementById('find-count');
	const findPrevButton = document.getElementById('find-prev');
	const findNextButton = document.getElementById('find-next');
	const findCloseButton = document.getElementById('find-close');

	// Find-in-document state
	let searchQuery = '';
	/** @type {Array<{ pageNum: number, start: number, end: number, globalIndex: number }>} */
	let matches = [];
	/** @type {Record<number, Array<{ pageNum: number, start: number, end: number, globalIndex: number }>>} */
	let matchesByPage = {};
	let currentMatchIndex = -1;
	/** Page text, cached so search and highlighting share one source of truth. @type {Record<number, { items: any[], text: string }>} */
	const pageTextCache = {};
	/** Bumped on every new search so a slow scan can detect it has been superseded. */
	let searchSeq = 0;

	// Load PDF.js dynamically
	let pdfjsLib = null;

	async function initPdfJs() {
		try {
			// @ts-ignore
			pdfjsLib = await import(window.pdfJsUrl);

			// VS Code webview sandbox can block direct Worker(url) loads from
			// vscode-webview://. Fetch the worker module text and serve it as a
			// blob URL so the worker is same-origin to the iframe.
			try {
				const response = await fetch(window.pdfWorkerUrl);
				if (!response.ok) {
					throw new Error(`fetch returned ${response.status}`);
				}
				const workerText = await response.text();
				const workerBlob = new Blob([workerText], { type: 'text/javascript' });
				// @ts-ignore
				pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
				console.log('[PDF Preview] PDF.js worker loaded as blob URL');
			} catch (workerError) {
				// Fallback to direct URL — if Blob path fails, PDF.js itself
				// will fall back further to a "fake worker" on the main thread.
				console.warn('[PDF Preview] Blob worker load failed, falling back to direct URL:', workerError);
				// @ts-ignore
				pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfWorkerUrl;
			}

			console.log('[PDF Preview] PDF.js loaded successfully');
		} catch (error) {
			console.error('[PDF Preview] Failed to load PDF.js:', error);
			showError('Failed to load PDF viewer', error.message);
		}
	}

	/**
	 * Load a PDF document from base64 data
	 * @param {string} base64Data
	 */
	async function loadPdf(base64Data) {
		if (!pdfjsLib) {
			await initPdfJs();
		}

		try {
			showLoading(true);

			// Convert base64 to Uint8Array
			const binaryString = atob(base64Data);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			// Load the PDF. Character maps and standard fonts are served from the
			// extension's bundled pdfjs-dist assets (see window.pdfCMapUrl); the webview
			// CSP blocks external hosts, so CJK patents would otherwise render blank.
			const loadingTask = pdfjsLib.getDocument({
				data: bytes,
				cMapUrl: window.pdfCMapUrl,
				cMapPacked: true,
				standardFontDataUrl: window.pdfStandardFontUrl,
			});

			pdfDoc = await loadingTask.promise;
			console.log(`[PDF Preview] Loaded PDF with ${pdfDoc.numPages} pages`);

			// Update UI
			pageCount.textContent = pdfDoc.numPages.toString();
			pageInput.max = pdfDoc.numPages.toString();

			// Build placeholder boxes for every page, then render only what is visible.
			await buildPagePlaceholders();
			setupObservers();
			await renderVisiblePages();

			showLoading(false);
			updateNavigation();

		} catch (error) {
			console.error('[PDF Preview] Error loading PDF:', error);
			showLoading(false);
			showError('Failed to load PDF', error.message);
			vscode.postMessage({ type: 'error', message: error.message });
		}
	}

	/**
	 * Create a correctly-sized placeholder box for every page without rendering it.
	 * Placeholder dimensions come from each page's own viewport (not page 1), so
	 * scroll geometry and the page-number indicator are accurate before render.
	 */
	async function buildPagePlaceholders() {
		viewer.innerHTML = '';
		pageStates.length = 0;

		for (let num = 1; num <= pdfDoc.numPages; num++) {
			const page = await pdfDoc.getPage(num);
			const viewport = page.getViewport({ scale: 1 });

			const container = document.createElement('div');
			container.className = 'pdf-page';
			container.id = `page-${num}`;
			container.dataset.pageNumber = num.toString();

			const canvas = document.createElement('canvas');
			container.appendChild(canvas);

			viewer.appendChild(container);

			const state = {
				num,
				container,
				canvas,
				page,
				baseViewport: { width: viewport.width, height: viewport.height },
				textItems: null,
				rendered: false,
				renderTask: null,
			};

			applyPlaceholderSize(state);
			pageStates[num] = state;
		}
	}

	/**
	 * Size a page's placeholder box to its scaled dimensions so the box holds space
	 * whether or not the page is currently rendered.
	 * @param {{ container: HTMLElement, baseViewport: { width: number, height: number } }} state
	 */
	function applyPlaceholderSize(state) {
		const width = Math.floor(state.baseViewport.width * scale);
		const height = Math.floor(state.baseViewport.height * scale);
		state.container.style.width = `${width}px`;
		state.container.style.height = `${height}px`;
	}

	/**
	 * Wire up the render/release observers against the scroll container.
	 * Pages within ~2 viewports of the visible area render; pages beyond ~4
	 * viewports are released to bound memory (hysteresis avoids thrashing).
	 */
	function setupObservers() {
		if (renderObserver) {
			renderObserver.disconnect();
		}
		if (releaseObserver) {
			releaseObserver.disconnect();
		}

		renderObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const state = pageStates[Number(entry.target.dataset.pageNumber)];
					if (state) {
						renderPage(state);
					}
				}
			}
		}, { root: viewerContainer, rootMargin: '200% 0px' });

		releaseObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) {
					const state = pageStates[Number(entry.target.dataset.pageNumber)];
					if (state) {
						releasePage(state);
					}
				}
			}
		}, { root: viewerContainer, rootMargin: '400% 0px' });

		for (let num = 1; num <= pdfDoc.numPages; num++) {
			renderObserver.observe(pageStates[num].container);
			releaseObserver.observe(pageStates[num].container);
		}
	}

	/**
	 * Render every page whose placeholder is currently within one viewport of the
	 * visible area. Used for the first paint and after a scale change (where the
	 * observer would not re-fire for pages that were already intersecting).
	 */
	async function renderVisiblePages() {
		if (!pdfDoc) {
			return;
		}

		const rootRect = viewerContainer.getBoundingClientRect();
		const margin = rootRect.height;
		const promises = [];

		for (let num = 1; num <= pdfDoc.numPages; num++) {
			const state = pageStates[num];
			const rect = state.container.getBoundingClientRect();
			if (rect.bottom >= rootRect.top - margin && rect.top <= rootRect.bottom + margin) {
				promises.push(renderPage(state));
			}
		}

		await Promise.all(promises);
	}

	/**
	 * Render a single page's canvas and text layer at the current scale.
	 * Guards against concurrent/duplicate renders of the same page.
	 * @param {typeof pageStates[number]} state
	 */
	async function renderPage(state) {
		if (state.rendered || state.renderTask) {
			return;
		}

		const viewport = state.page.getViewport({ scale });
		const canvas = state.canvas;

		// Render the canvas bitmap at the device's physical resolution so the
		// output stays crisp on HiDPI / Retina displays, while keeping the CSS
		// (layout) size at the logical viewport size.
		const outputScale = window.devicePixelRatio || 1;

		canvas.width = Math.floor(viewport.width * outputScale);
		canvas.height = Math.floor(viewport.height * outputScale);
		canvas.style.width = `${Math.floor(viewport.width)}px`;
		canvas.style.height = `${Math.floor(viewport.height)}px`;

		const ctx = canvas.getContext('2d');

		const renderContext = {
			canvasContext: ctx,
			viewport: viewport,
			transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
		};

		const task = state.page.render(renderContext);
		state.renderTask = task;

		try {
			await task.promise;
		} catch (error) {
			state.renderTask = null;
			// A cancelled render (e.g. released or re-scaled mid-render) is expected.
			if (error && error.name === 'RenderingCancelledException') {
				return;
			}
			throw error;
		}

		state.renderTask = null;
		state.rendered = true;

		await buildTextLayer(state, viewport);
	}

	/**
	 * Fetch and cache a page's text content. The concatenation used here (item strings
	 * joined with no separator) is the single source of truth for both search offsets
	 * and highlight placement, so the two never disagree.
	 * @param {number} num
	 */
	async function buildPageText(num) {
		if (pageTextCache[num]) {
			return pageTextCache[num];
		}
		const page = pageStates[num] ? pageStates[num].page : await pdfDoc.getPage(num);
		const textContent = await page.getTextContent();
		let text = '';
		for (const item of textContent.items) {
			text += item.str || '';
		}
		const entry = { items: textContent.items, text: text.toLowerCase() };
		pageTextCache[num] = entry;
		return entry;
	}

	/**
	 * Build (or rebuild) the selectable text layer for a rendered page, wrapping any
	 * active find matches in highlight spans.
	 * @param {typeof pageStates[number]} state
	 * @param {any} viewport
	 */
	async function buildTextLayer(state, viewport) {
		const existing = state.container.querySelector('.text-layer');
		if (existing) {
			existing.remove();
		}

		const entry = await buildPageText(state.num);
		state.textItems = entry.items;

		const textLayer = document.createElement('div');
		textLayer.className = 'text-layer';
		textLayer.style.width = `${viewport.width}px`;
		textLayer.style.height = `${viewport.height}px`;
		state.container.appendChild(textLayer);

		const pageMatches = searchQuery ? matchesByPage[state.num] : null;
		let offset = 0;

		for (const item of entry.items) {
			const str = item.str || '';
			const itemStart = offset;
			offset += str.length;

			if (!str) {
				continue;
			}

			const span = document.createElement('span');

			const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

			const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
			const angle = Math.atan2(tx[1], tx[0]);

			span.style.left = `${tx[4]}px`;
			span.style.top = `${tx[5] - fontHeight}px`;
			span.style.fontSize = `${fontHeight}px`;
			span.style.fontFamily = item.fontName || 'sans-serif';

			if (angle !== 0) {
				span.style.transform = `rotate(${angle}rad)`;
			}

			if (pageMatches && pageMatches.length) {
				appendItemContent(span, str, itemStart, pageMatches);
			} else {
				span.textContent = str;
			}

			textLayer.appendChild(span);
		}
	}

	/**
	 * Fill a text-layer span, splitting out any characters covered by a find match
	 * into highlight sub-spans (the current match gets an extra class).
	 * @param {HTMLElement} span
	 * @param {string} str original-case glyph string for this item
	 * @param {number} itemStart char offset of this item within the page text
	 * @param {Array<{ start: number, end: number, globalIndex: number }>} pageMatches
	 */
	function appendItemContent(span, str, itemStart, pageMatches) {
		const itemEnd = itemStart + str.length;
		const overlapping = pageMatches
			.filter(m => m.start < itemEnd && m.end > itemStart)
			.sort((a, b) => a.start - b.start);

		if (!overlapping.length) {
			span.textContent = str;
			return;
		}

		let cursor = 0;
		for (const match of overlapping) {
			const segStart = Math.max(match.start, itemStart) - itemStart;
			const segEnd = Math.min(match.end, itemEnd) - itemStart;

			if (segStart > cursor) {
				span.appendChild(document.createTextNode(str.slice(cursor, segStart)));
			}

			const highlight = document.createElement('span');
			highlight.className = match.globalIndex === currentMatchIndex ? 'find-highlight current' : 'find-highlight';
			highlight.textContent = str.slice(segStart, segEnd);
			span.appendChild(highlight);

			cursor = segEnd;
		}

		if (cursor < str.length) {
			span.appendChild(document.createTextNode(str.slice(cursor)));
		}
	}

	/**
	 * Rebuild the text layer (with current highlights) for every rendered page.
	 */
	async function refreshRenderedHighlights() {
		const jobs = [];
		for (let num = 1; num <= pdfDoc.numPages; num++) {
			const state = pageStates[num];
			if (state && state.rendered) {
				jobs.push(buildTextLayer(state, state.page.getViewport({ scale })));
			}
		}
		await Promise.all(jobs);
	}

	/**
	 * Run a case-insensitive substring search across the whole document. Text content
	 * is read per page (getTextContent) without requiring the page to be rendered, so
	 * matches on lazily-rendered pages are found. Jumps to the first match.
	 * @param {string} query
	 */
	async function runSearch(query) {
		const seq = ++searchSeq;
		searchQuery = query;
		matches = [];
		matchesByPage = {};
		currentMatchIndex = -1;

		if (!query || !pdfDoc) {
			updateFindCount();
			await refreshRenderedHighlights();
			return;
		}

		const needle = query.toLowerCase();

		for (let num = 1; num <= pdfDoc.numPages; num++) {
			const { text } = await buildPageText(num);
			if (seq !== searchSeq) {
				return; // superseded by a newer search
			}

			const pageMatches = [];
			let idx = text.indexOf(needle);
			while (idx !== -1) {
				const match = { pageNum: num, start: idx, end: idx + needle.length, globalIndex: matches.length };
				matches.push(match);
				pageMatches.push(match);
				idx = text.indexOf(needle, idx + needle.length);
			}
			if (pageMatches.length) {
				matchesByPage[num] = pageMatches;
			}
		}

		updateFindCount();

		if (matches.length) {
			await goToMatch(0);
		} else {
			await refreshRenderedHighlights();
		}
	}

	/**
	 * Select and reveal a match by its document-order index (wraps around). Renders the
	 * match's page if it is not yet rendered, then scrolls the highlight into view.
	 * @param {number} index
	 */
	async function goToMatch(index) {
		if (!matches.length) {
			return;
		}

		currentMatchIndex = ((index % matches.length) + matches.length) % matches.length;
		const match = matches[currentMatchIndex];

		currentPage = match.pageNum;
		pageInput.value = currentPage.toString();
		updateNavigation();

		const state = pageStates[match.pageNum];
		await renderPage(state);
		await refreshRenderedHighlights();

		const current = state.container.querySelector('.find-highlight.current');
		if (current) {
			current.scrollIntoView({ block: 'center', behavior: 'smooth' });
		} else {
			state.container.scrollIntoView({ block: 'start' });
		}

		updateFindCount();
	}

	/**
	 * Update the "n of m" match counter.
	 */
	function updateFindCount() {
		if (!searchQuery) {
			findCount.textContent = '';
			findCount.classList.remove('no-results');
			return;
		}
		if (!matches.length) {
			findCount.textContent = 'No results';
			findCount.classList.add('no-results');
			return;
		}
		findCount.classList.remove('no-results');
		findCount.textContent = `${currentMatchIndex + 1} of ${matches.length}`;
	}

	/**
	 * Open the find bar and focus its input.
	 */
	function openFind() {
		findBar.classList.remove('hidden');
		findInput.focus();
		findInput.select();
	}

	/**
	 * Close the find bar and clear all highlights.
	 */
	async function closeFind() {
		findBar.classList.add('hidden');
		searchQuery = '';
		matches = [];
		matchesByPage = {};
		currentMatchIndex = -1;
		++searchSeq;
		updateFindCount();
		if (pdfDoc) {
			await refreshRenderedHighlights();
		}
	}

	/**
	 * Release a page's canvas and text layer to bound memory. The placeholder box
	 * keeps its dimensions, so scroll geometry is preserved.
	 * @param {typeof pageStates[number]} state
	 */
	function releasePage(state) {
		if (state.renderTask) {
			state.renderTask.cancel();
			state.renderTask = null;
		}

		if (!state.rendered) {
			return;
		}

		state.canvas.width = 0;
		state.canvas.height = 0;
		state.canvas.style.width = '';
		state.canvas.style.height = '';

		const textLayer = state.container.querySelector('.text-layer');
		if (textLayer) {
			textLayer.remove();
		}

		state.rendered = false;
	}

	/**
	 * Apply a new scale: resize every placeholder, drop rendered canvases (they are
	 * re-rendered lazily), and re-render the pages currently in view.
	 * @param {number} newScale
	 */
	async function setScale(newScale) {
		newScale = Math.max(0.25, Math.min(4.0, newScale));
		if (!pdfDoc || newScale === scale) {
			return;
		}

		scale = newScale;

		for (let num = 1; num <= pdfDoc.numPages; num++) {
			const state = pageStates[num];
			applyPlaceholderSize(state);
			releasePage(state);
		}

		updateZoomDisplay();
		await renderVisiblePages();

		// Keep the page the user was looking at anchored after the reflow.
		const anchor = document.getElementById(`page-${currentPage}`);
		if (anchor) {
			anchor.scrollIntoView({ block: 'start' });
		}
	}

	/**
	 * Go to a specific page
	 * @param {number} pageNum
	 */
	function goToPage(pageNum) {
		if (!pdfDoc) {
			return;
		}

		pageNum = Math.max(1, Math.min(pageNum, pdfDoc.numPages));
		currentPage = pageNum;
		pageInput.value = pageNum.toString();

		const pageElement = document.getElementById(`page-${pageNum}`);
		if (pageElement) {
			pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}

		updateNavigation();
		vscode.postMessage({ type: 'pageChanged', page: currentPage });
	}

	/**
	 * Zoom by delta
	 * @param {number} delta
	 */
	function zoom(delta) {
		setScale(scale + delta);
	}

	/**
	 * Fit to container width
	 */
	function fitToWidth() {
		if (!pdfDoc || !pageStates[currentPage]) {
			return;
		}

		const containerWidth = viewerContainer.clientWidth - 60; // Account for padding
		const base = pageStates[currentPage].baseViewport;
		setScale(containerWidth / base.width);
	}

	/**
	 * Update navigation button states
	 */
	function updateNavigation() {
		if (!pdfDoc) {
			return;
		}

		prevButton.disabled = currentPage <= 1;
		nextButton.disabled = currentPage >= pdfDoc.numPages;
	}

	/**
	 * Update zoom display
	 */
	function updateZoomDisplay() {
		zoomLevel.textContent = `${Math.round(scale * 100)}%`;
	}

	/**
	 * Show/hide loading indicator
	 * @param {boolean} show
	 */
	function showLoading(show) {
		loading.classList.toggle('hidden', !show);
	}

	/**
	 * Show error message
	 * @param {string} title
	 * @param {string} message
	 */
	function showError(title, message) {
		// Build the card with textContent so message strings (which may contain
		// markup-like characters, e.g. from PDF error text) render literally.
		viewer.innerHTML = '';

		const card = document.createElement('div');
		card.className = 'error-message';

		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('fill', 'currentColor');
		path.setAttribute('d', 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 4h2v5H7V4zm0 6h2v2H7v-2z');
		icon.appendChild(path);
		card.appendChild(icon);

		const heading = document.createElement('h2');
		heading.textContent = title;
		card.appendChild(heading);

		const paragraph = document.createElement('p');
		paragraph.textContent = message;
		card.appendChild(paragraph);

		viewer.appendChild(card);
	}

	// Event Listeners
	prevButton.addEventListener('click', () => goToPage(currentPage - 1));
	nextButton.addEventListener('click', () => goToPage(currentPage + 1));

	zoomInButton.addEventListener('click', () => zoom(0.25));
	zoomOutButton.addEventListener('click', () => zoom(-0.25));
	zoomFitButton.addEventListener('click', fitToWidth);

	pageInput.addEventListener('change', () => {
		const page = parseInt(pageInput.value);
		if (!isNaN(page)) {
			goToPage(page);
		}
	});

	pageInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			const page = parseInt(pageInput.value);
			if (!isNaN(page)) {
				goToPage(page);
			}
		}
	});

	extractTextButton.addEventListener('click', () => {
		vscode.postMessage({ type: 'extractText' });
	});

	/**
	 * Restore the OCR button from its "Processing..." state. Every path out of an OCR attempt —
	 * success, failure, and consent refusal — must call this or the button stays disabled.
	 */
	function resetOcrButton() {
		if (extractOcrButton) {
			extractOcrButton.disabled = false;
			extractOcrButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M1 3v10h14V3H1zm1 1h12v8H2V4zm2 1v2h2V5H4zm3 0v2h5V5H7zM4 8v2h8V8H4z"/></svg> Extract with OCR';
		}
	}

	extractOcrButton.addEventListener('click', () => {
		extractOcrButton.disabled = true;
		extractOcrButton.textContent = 'Processing...';
		vscode.postMessage({ type: 'extractTextOCR' });
	});

	// Find-in-document
	findToggleButton.addEventListener('click', () => {
		if (findBar.classList.contains('hidden')) {
			openFind();
		} else {
			closeFind();
		}
	});

	let findDebounce = null;
	findInput.addEventListener('input', () => {
		if (findDebounce) {
			clearTimeout(findDebounce);
		}
		findDebounce = setTimeout(() => runSearch(findInput.value), 150);
	});

	findInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (matches.length) {
				goToMatch(currentMatchIndex + (e.shiftKey ? -1 : 1));
			} else {
				runSearch(findInput.value);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
			viewerContainer.focus();
		}
	});

	findPrevButton.addEventListener('click', () => goToMatch(currentMatchIndex - 1));
	findNextButton.addEventListener('click', () => goToMatch(currentMatchIndex + 1));
	findCloseButton.addEventListener('click', () => closeFind());

	// Keyboard navigation
	document.addEventListener('keydown', (e) => {
		// Standard find keybinding opens the find bar when the preview has focus.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
			openFind();
			e.preventDefault();
			return;
		}

		// The find input handles its own keys (Enter/Shift+Enter/Escape).
		if (e.target === findInput) {
			return;
		}

		if (e.key === 'Escape' && !findBar.classList.contains('hidden')) {
			closeFind();
			e.preventDefault();
			return;
		}

		if (e.target === pageInput) {
			return;
		}

		switch (e.key) {
			case 'ArrowLeft':
			case 'PageUp':
				goToPage(currentPage - 1);
				e.preventDefault();
				break;
			case 'ArrowRight':
			case 'PageDown':
				goToPage(currentPage + 1);
				e.preventDefault();
				break;
			case 'Home':
				goToPage(1);
				e.preventDefault();
				break;
			case 'End':
				if (pdfDoc) {
					goToPage(pdfDoc.numPages);
				}
				e.preventDefault();
				break;
			case '+':
			case '=':
				if (e.ctrlKey || e.metaKey) {
					zoom(0.25);
					e.preventDefault();
				}
				break;
			case '-':
				if (e.ctrlKey || e.metaKey) {
					zoom(-0.25);
					e.preventDefault();
				}
				break;
		}
	});

	// Scroll tracking to update current page
	viewerContainer.addEventListener('scroll', () => {
		if (!pdfDoc) {
			return;
		}

		const pages = viewer.querySelectorAll('.pdf-page');
		const containerRect = viewerContainer.getBoundingClientRect();
		const containerCenter = containerRect.top + containerRect.height / 2;

		let closestPage = 1;
		let closestDistance = Infinity;

		for (const page of pages) {
			const rect = page.getBoundingClientRect();
			const pageCenter = rect.top + rect.height / 2;
			const distance = Math.abs(pageCenter - containerCenter);

			if (distance < closestDistance) {
				closestDistance = distance;
				closestPage = parseInt(page.dataset.pageNumber);
			}
		}

		if (closestPage !== currentPage) {
			currentPage = closestPage;
			pageInput.value = currentPage.toString();
			updateNavigation();
		}
	});

	// Handle messages from the extension
	window.addEventListener('message', async (event) => {
		const message = event.data;

		switch (message.type) {
			case 'loadPdf':
				await loadPdf(message.data);
				break;

			case 'goToPage':
				goToPage(message.page);
				break;

			case 'zoom':
				zoom(message.delta);
				break;

			case 'textExtracted':
				// Text was extracted, could show notification
				console.log('[PDF Preview] Text extracted successfully');
				break;

			case 'ocrStarted':
				console.log('[PDF Preview] OCR started');
				break;

			case 'ocrComplete':
				console.log('[PDF Preview] OCR completed successfully');
				resetOcrButton();
				break;

			case 'ocrError':
				console.error('[PDF Preview] OCR failed:', message.message);
				resetOcrButton();
				break;

			case 'ocrCancelled':
				// The user has not consented to uploading the document, so nothing ran.
				// The button must come back out of its "Processing..." state.
				console.log('[PDF Preview] OCR cancelled before upload');
				resetOcrButton();
				break;
		}
	});

	// Initialize
	await initPdfJs();
	updateZoomDisplay();

	// Tell the extension we're ready
	vscode.postMessage({ type: 'ready' });
})();
