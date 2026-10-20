import { writeFileSync } from 'node:fs';
import { evaluate, cdp, waitFor } from '../../artifacts/table-view-2026-10-19/regression-driver.mjs';

const root = new URL('./', import.meta.url);
const response = await fetch('http://localhost:3456/new', { method: 'POST', body: 'http://127.0.0.1:8097/?first=rec001&hostRecord=rec001&storage=manual-20261020' }).then(r => r.json());
const tab = response.targetId;
const setup = "document.querySelector('main')?.__vueParentComponent?.setupState";
const action = code => evaluate(tab, `(async()=>{const s=${setup};${code}})()`);
const settle = () => waitFor(tab, `(()=>{const s=${setup};return s && s.templateLoaded && !s.busy && !!document.querySelector('iframe.preview-frame')?.contentDocument?.body?.innerText})()`);
const pause = ms => new Promise(r => setTimeout(r, ms));
cdp(tab, 'Emulation.setDeviceMetricsOverride', { width: 1200, height: 660, deviceScaleFactor: 1, mobile: false });
cdp(tab, 'Emulation.setFocusEmulationEnabled', { enabled: true });
await settle();
await action('await s.enterEditMode();await s.saveTemplate({returnToPreview:true});');
await settle();
await action("await s.requestDirectoryAction('rename',s.templateCollection.templates[0]);s.templateRenameInput='订单打印单';await s.confirmTemplateManagement();");
await pause(2600);

function rect(selector) {
  return evaluate(tab, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
}
function buttonRect(text) {
  return evaluate(tab, `(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===${JSON.stringify(text)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
}
async function save(name, marks = []) {
  cdp(tab, 'Page.bringToFront', {});
  await pause(300);
  const screenshot = cdp(tab, 'Page.captureScreenshot', { format: 'png' }).result.data;
  writeFileSync(new URL(`${name}-raw.png`, root), Buffer.from(screenshot, 'base64'));
  const annotated = await fetch(`http://localhost:3456/eval?target=${tab}`, { method: 'POST', body: `(async()=>{
    const img=new Image();img.src=${JSON.stringify('data:image/png;base64,' + screenshot)};await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height+68;const g=c.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,68);
    g.fillStyle='#1f2937';g.font='600 21px "Microsoft YaHei",sans-serif';
    const marks=${JSON.stringify(marks.filter(m => m.rect))};
    marks.forEach((m,i)=>{
      const lx=24+i*(c.width/Math.max(marks.length,1));
      g.fillStyle='#2468ef';g.beginPath();g.arc(lx+12,33,13,0,Math.PI*2);g.fill();
      g.fillStyle='#fff';g.textAlign='center';g.font='600 17px "Microsoft YaHei",sans-serif';g.fillText(String(i+1),lx+12,39);
      g.textAlign='left';g.fillStyle='#1f2937';g.font='600 21px "Microsoft YaHei",sans-serif';g.fillText(m.label,lx+34,41);
      const r=m.rect;g.strokeStyle='#2468ef';g.lineWidth=3;g.strokeRect(r.x-3,r.y+65,r.w+6,r.h+6);
      const cx=Math.max(14,r.x+3),cy=r.y+68+4;g.fillStyle='#2468ef';g.beginPath();g.arc(cx,cy,12,0,Math.PI*2);g.fill();
      g.fillStyle='#fff';g.textAlign='center';g.font='600 16px "Microsoft YaHei",sans-serif';g.fillText(String(i+1),cx,cy+6);g.textAlign='left';
    });
    return c.toDataURL('image/png').split(',')[1];
  })()` }).then(r=>r.json());
  if (annotated.error) throw new Error(JSON.stringify(annotated));
  writeFileSync(new URL(`${name}.png`, root), Buffer.from(annotated.value, 'base64'));
  console.log(name);
}

await save('01-print', [
  { label: '选模板', rect: rect('.template-directory-row') },
  { label: '核对记录和预览', rect: rect('.workspace-heading') },
  { label: '导出 PDF 或打印', rect: (()=>{const a=buttonRect('导出 PDF'),b=buttonRect('打印');return a&&b?{x:a.x,y:a.y,w:b.x+b.w-a.x,h:a.h}:null})() }
]);
await action('s.newTemplateMenuOpen=true;');
await save('02-new-template', [{ label: '新建模板，推荐自动生成', rect: rect('.template-create-menu') }]);
await action('s.newTemplateMenuOpen=false;await s.enterEditMode();');
await pause(2700);
await save('03-edit', [
  { label: '选择数据源或组件', rect: rect('.editor-sidebar') },
  { label: '在画布调整版式', rect: rect('print-designer') },
  { label: '保存模板', rect: buttonRect('保存模板') }
]);
console.log(JSON.stringify({ tab, editor: evaluate(tab, `(()=>{const d=document.querySelector('print-designer');return {light:d?.innerText?.slice(0,2000),shadow:d?.shadowRoot?.innerHTML?.slice(0,1000),elements:[...d?.querySelectorAll('*')??[]].slice(0,5).map(e=>e.tagName)}})()`) }));
writeFileSync(new URL('capture-state.json',root), JSON.stringify({ tab }, null, 2));
