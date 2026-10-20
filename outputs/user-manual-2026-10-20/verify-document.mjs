import { writeFileSync } from 'node:fs';
import { cdp, evaluate } from '../../artifacts/table-view-2026-10-19/regression-driver.mjs';
const tab = '2B051AF24A922ADEE17182DF08E62541';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
cdp(tab, 'Emulation.setDeviceMetricsOverride', {width:1400,height:1000,deviceScaleFactor:1,mobile:false});
cdp(tab, 'Page.bringToFront', {});
await pause(900);
for (const [name, scroll] of [['document-top',0],['document-middle',1450],['document-bottom',10000]]) {
  evaluate(tab, `document.querySelector('.bear-web-x-container').scrollTop=${scroll}`);
  await pause(900);
  const shot = cdp(tab, 'Page.captureScreenshot', {format:'png'}).result.data;
  writeFileSync(new URL(`${name}.png`, import.meta.url), Buffer.from(shot,'base64'));
}
console.log(JSON.stringify(evaluate(tab, `({text:document.body.innerText,images:[...document.querySelectorAll('img')].map(e=>({loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight}))})`)));
