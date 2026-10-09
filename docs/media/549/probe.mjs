/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// #549 live check. Boot a reh-web package with a workspace that holds anchors.md (two Source
// anchors), then: node probe.mjs <port> "US6265989B1:claims:1:en" out.png
// Prints the editor tabs after the click; a "US6265989B1" tab means the patent reader opened.
import { createRequire } from 'module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');

const [port, linkText, shot] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
page.on('popup', p => logs.push(`[popup] ${p.url()}`));
await page.goto(`http://127.0.0.1:${port}/?folder=/root/workspace`);
await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
await page.waitForTimeout(6000);
await page.keyboard.press('Meta+P');
await page.waitForTimeout(800);
await page.keyboard.type('anchors.md');
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

let clicked = false;
for (let attempt = 0; attempt < 20 && !clicked; attempt++) {
if (attempt) { await page.waitForTimeout(1000); }
for (const frame of page.frames()) {
	const pub = linkText.split(':')[0];
	const link = frame.locator(`a[href*="${pub}"], [data-md-url*="${pub}"]`);
	if (await link.count().catch(() => 0)) {
		logs.push(`[probe] clicking "${linkText}" in frame ${frame.url().slice(0, 80)}`);
		logs.push('[probe] element ' + await link.first().evaluate(e => { const a = e.closest('a,[data-md-url],[role=link]') ?? e; return a.outerHTML.slice(0, 400) + ' active=' + !!a.closest('.md-block-active'); }));
		await link.first().click();
		clicked = true;
		break;
	}
}
}
if (!clicked) {
	logs.push('[probe] link not found in any frame');
}
await page.waitForTimeout(4000);
const dialog = page.locator('.monaco-dialog-box');
if (await dialog.count()) {
	logs.push('[probe] dialog: ' + (await dialog.first().innerText()).replace(/\s+/g, ' ').slice(0, 200));
	if (shot) {
		await page.screenshot({ path: shot.replace(/(\.\w+)$/, '-dialog$1'), type: shot.endsWith('.jpg') ? 'jpeg' : 'png', quality: shot.endsWith('.jpg') ? 70 : undefined });
	}
	await dialog.getByRole('button', { name: 'Open' }).click();
}
await page.waitForTimeout(6000);
const tabs = await page.$$eval('.tabs-container .tab', ts => ts.map(t => t.getAttribute('aria-label')));
const notifications = await page.$$eval('.notification-toast, .monaco-dialog-box', ns => ns.map(n => n.textContent?.slice(0, 200)));
console.log(JSON.stringify({ tabs, notifications }, null, 1));
console.log(logs.filter(l => !/Chromium|ENOENT|ChatModelSelection|AccountPolicyGate|builtin extensions/.test(l)).join('\n'));
if (shot) {
	await page.screenshot({ path: shot, type: shot.endsWith('.jpg') ? 'jpeg' : 'png', quality: shot.endsWith('.jpg') ? 70 : undefined });
}
await browser.close();
