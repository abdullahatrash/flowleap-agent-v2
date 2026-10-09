# FlowLeap

Built-in extension of FlowLeap Patent AI: the Home dashboard, the project sidebar, the chat
bar, the browser launcher, the update notifier and the HTML file preview.

## HTML file preview

An `.html` file opens rendered in a read-only editor (**Open HTML Source** shows the text).
**FlowLeap: Preview HTML File** opens the same editor. It works on desktop and in a hosted
workspace.

The rendered page runs under a Content Security Policy (`src/htmlPreview/htmlPreviewDocument.ts`,
`PREVIEW_CDN_ORIGINS` is the single source of the list):

- Inline scripts and styles are allowed.
- Images, fonts and media may load from the file's folder, `data:` and `blob:`.
- Scripts, styles, fonts and images may also load from these origins only:
  `https://cdn.jsdelivr.net`, `https://unpkg.com`, `https://cdnjs.cloudflare.com`,
  `https://fonts.googleapis.com`, `https://fonts.gstatic.com`.
- Network requests are blocked: `connect-src 'none'` (no `fetch()`, XHR, WebSocket or beacon).
- Frames are blocked (no `frame-src`).

To change the origin list, edit `PREVIEW_CDN_ORIGINS`, this README and
`src/test/htmlPreviewDocument.test.ts` together.
