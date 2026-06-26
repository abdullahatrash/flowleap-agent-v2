/*---------------------------------------------------------------------------------------------
 *  Copyright (c) FlowLeap. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

/**
 * PDF Preview Webview Script
 * Uses PDF.js to render PDF documents in VS Code webview
 */
(async function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	// State
	let pdfDoc = null;
	let currentPage = 1;
	let scale = 1.0;
	let rendering = false;
	let pendingPage = null;

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

			// Load the PDF
			const loadingTask = pdfjsLib.getDocument({
				data: bytes,
				cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
				cMapPacked: true,
			});

			pdfDoc = await loadingTask.promise;
			console.log(`[PDF Preview] Loaded PDF with ${pdfDoc.numPages} pages`);

			// Update UI
			pageCount.textContent = pdfDoc.numPages.toString();
			pageInput.max = pdfDoc.numPages.toString();

			// Render all pages
			await renderAllPages();

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
	 * Render all pages of the PDF
	 */
	async function renderAllPages() {
		viewer.innerHTML = '';

		for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
			const pageContainer = document.createElement('div');
			pageContainer.className = 'pdf-page';
			pageContainer.id = `page-${pageNum}`;
			pageContainer.dataset.pageNumber = pageNum.toString();

			const canvas = document.createElement('canvas');
			pageContainer.appendChild(canvas);

			viewer.appendChild(pageContainer);

			await renderPage(pageNum, canvas);
		}
	}

	/**
	 * Render a single page
	 * @param {number} pageNum
	 * @param {HTMLCanvasElement} canvas
	 */
	async function renderPage(pageNum, canvas) {
		const page = await pdfDoc.getPage(pageNum);

		const viewport = page.getViewport({ scale: scale });

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

		await page.render(renderContext).promise;

		// Add text layer for selection
		const textContent = await page.getTextContent();
		const textLayer = document.createElement('div');
		textLayer.className = 'text-layer';
		textLayer.style.width = `${viewport.width}px`;
		textLayer.style.height = `${viewport.height}px`;

		canvas.parentElement.appendChild(textLayer);

		// Render text layer
		for (const item of textContent.items) {
			if (!item.str) continue;

			const span = document.createElement('span');
			span.textContent = item.str;

			const tx = pdfjsLib.Util.transform(
				viewport.transform,
				item.transform
			);

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
	 * Re-render all pages with new scale
	 */
	async function rerender() {
		if (!pdfDoc) return;

		const pages = viewer.querySelectorAll('.pdf-page');
		for (const pageContainer of pages) {
			const pageNum = parseInt(pageContainer.dataset.pageNumber);
			const canvas = pageContainer.querySelector('canvas');
			const textLayer = pageContainer.querySelector('.text-layer');

			if (textLayer) {
				textLayer.remove();
			}

			await renderPage(pageNum, canvas);
		}

		updateZoomDisplay();
	}

	/**
	 * Go to a specific page
	 * @param {number} pageNum
	 */
	function goToPage(pageNum) {
		if (!pdfDoc) return;

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
		const newScale = Math.max(0.25, Math.min(4.0, scale + delta));
		if (newScale !== scale) {
			scale = newScale;
			rerender();
		}
	}

	/**
	 * Fit to container width
	 */
	function fitToWidth() {
		if (!pdfDoc) return;

		const container = document.getElementById('viewer-container');
		const containerWidth = container.clientWidth - 60; // Account for padding

		pdfDoc.getPage(1).then(page => {
			const viewport = page.getViewport({ scale: 1.0 });
			scale = containerWidth / viewport.width;
			rerender();
		});
	}

	/**
	 * Update navigation button states
	 */
	function updateNavigation() {
		if (!pdfDoc) return;

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
		if (e.target === pageInput) return;

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
	const viewerContainer = document.getElementById('viewer-container');
	viewerContainer.addEventListener('scroll', () => {
		if (!pdfDoc) return;

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
