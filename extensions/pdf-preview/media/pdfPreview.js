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
	 * Build (or rebuild) the selectable text layer for a rendered page.
	 * Caches the page's text items on the state for reuse by find-in-document.
	 * @param {typeof pageStates[number]} state
	 * @param {any} viewport
	 */
	async function buildTextLayer(state, viewport) {
		const existing = state.container.querySelector('.text-layer');
		if (existing) {
			existing.remove();
		}

		const textContent = await state.page.getTextContent();
		state.textItems = textContent.items;

		const textLayer = document.createElement('div');
		textLayer.className = 'text-layer';
		textLayer.style.width = `${viewport.width}px`;
		textLayer.style.height = `${viewport.height}px`;
		state.container.appendChild(textLayer);

		for (const item of textContent.items) {
			if (!item.str) {
				continue;
			}

			const span = document.createElement('span');
			span.textContent = item.str;

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

			textLayer.appendChild(span);
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
		viewer.innerHTML = `
			<div class="error-message">
				<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 4h2v5H7V4zm0 6h2v2H7v-2z"/></svg>
				<h2>${title}</h2>
				<p>${message}</p>
			</div>
		`;
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

	extractOcrButton.addEventListener('click', () => {
		extractOcrButton.disabled = true;
		extractOcrButton.textContent = 'Processing...';
		vscode.postMessage({ type: 'extractTextOCR' });
	});

	// Keyboard navigation
	document.addEventListener('keydown', (e) => {
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
				if (extractOcrButton) {
					extractOcrButton.disabled = false;
					extractOcrButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M1 3v10h14V3H1zm1 1h12v8H2V4zm2 1v2h2V5H4zm3 0v2h5V5H7zM4 8v2h8V8H4z"/></svg> OCR Extract';
				}
				break;

			case 'ocrError':
				console.error('[PDF Preview] OCR failed:', message.message);
				if (extractOcrButton) {
					extractOcrButton.disabled = false;
					extractOcrButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M1 3v10h14V3H1zm1 1h12v8H2V4zm2 1v2h2V5H4zm3 0v2h5V5H7zM4 8v2h8V8H4z"/></svg> OCR Extract';
				}
				break;
		}
	});

	// Initialize
	await initPdfJs();
	updateZoomDisplay();

	// Tell the extension we're ready
	vscode.postMessage({ type: 'ready' });
})();
