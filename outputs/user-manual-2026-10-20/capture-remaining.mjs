import { readFileSync, writeFileSync } from 'node:fs';
import { cdp, evaluate, waitFor } from '../../artifacts/table-view-2026-10-19/regression-driver.mjs';

const tab = JSON.parse(readFileSync(new URL('capture-state.json', import.meta.url))).tab;
const root = new URL('./', import.meta.url);
const setup = "document.querySelector('main').__vueParentComponent.setupState";
const pause = ms => new Promise(r => setTimeout(r, ms));
const action = code => evaluate(tab, `(async()=>{const s=${setup};${code}})()`);
const rect = expression => evaluate(tab, `(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const css = selector => rect(`document.querySelector(${JSON.stringify(selector)})`);
const btn = text => rect(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===${JSON.stringify(text)})`);
const settle = () => waitFor(tab, `(()=>{const s=${setup};return s.templateLoaded&&!s.busy&&!!document.querySelector('iframe.preview-frame')?.contentDocument?.body?.innerText})()`);
export async function save(name, marks, crop = null) {
  cdp(tab, 'Page.bringToFront', {});
  await pause(400);
  const screenshot = cdp(tab, 'Page.captureScreenshot', { format: 'png' }).result.data;
  writeFileSync(new URL(`${name}-raw.png`, root), Buffer.from(screenshot, 'base64'));
  const result = await fetch(`http://localhost:3456/eval?target=${tab}`, { method:'POST',body:`(async()=>{
    const img=new Image();img.src=${JSON.stringify('data:image/png;base64,'+screenshot)};await img.decode();
    const crop=${JSON.stringify(crop)}??{x:0,y:0,w:img.width,h:img.height};
    const c=document.createElement('canvas');c.width=crop.w;c.height=crop.h+68;const g=c.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,crop.x,crop.y,crop.w,crop.h,0,68,crop.w,crop.h);
    const marks=${JSON.stringify(marks.filter(m=>m.rect))};
    marks.forEach((m,i)=>{
      const lx=20+i*c.width/marks.length;
      g.fillStyle='#2468ef';g.beginPath();g.arc(lx+12,33,13,0,Math.PI*2);g.fill();
      g.fillStyle='#fff';g.textAlign='center';g.font='600 17px "Microsoft YaHei"';g.fillText(String(i+1),lx+12,39);
      g.textAlign='left';g.fillStyle='#1f2937';g.font='600 20px "Microsoft YaHei"';g.fillText(m.label,lx+34,40);
      const r=m.rect,x=r.x-crop.x,y=r.y-crop.y+68;
      g.strokeStyle='#2468ef';g.lineWidth=3;g.strokeRect(x-3,y-3,r.w+6,r.h+6);
      const cx=Math.max(14,x+3),cy=Math.max(82,y+4);g.fillStyle='#2468ef';g.beginPath();g.arc(cx,cy,12,0,Math.PI*2);g.fill();
      g.fillStyle='#fff';g.textAlign='center';g.font='600 16px "Microsoft YaHei"';g.fillText(String(i+1),cx,cy+6);g.textAlign='left';
    });return c.toDataURL('image/png').split(',')[1];})()` }).then(r=>r.json());
  if(result.error)throw Error(JSON.stringify(result));
  writeFileSync(new URL(`${name}.png`,root),Buffer.from(result.value,'base64'));
  console.log(name);
}

if(process.argv.includes('--library')) {
  // The capture helpers can be reused without changing the current screen.
} else {
await evaluate(tab, `(()=>{const r=document.querySelector('print-designer').shadowRoot; r.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));return true})()`);
await pause(500);
await save('04-field',[
  {label:'点击字段复制',rect:css('[aria-label="复制数据源 客户名称"]')},
  {label:'选中要显示数据的文本',rect:rect(`document.querySelector('print-designer').shadowRoot.querySelector('[data-element-id="auto-field-2"]')`)},
  {label:'粘贴到内容',rect:rect(`[...document.querySelector('print-designer').shadowRoot.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容')?.parentElement`)}
]);

await action('await s.saveTemplate({returnToPreview:true});');
await settle();
await pause(2600);
await action('s.newTemplateMenuOpen=true;');
await save('02-new-template',[{label:'新建 → 自动生成模板',rect:css('.template-create-menu')}],{x:0,y:345,w:390,h:315});
await action('s.newTemplateMenuOpen=false;await s.enterEditMode();');
await pause(700);
await save('03-edit',[
  {label:'数据源与组件',rect:css('.sidebar')},
  {label:'拖动调整位置和大小',rect:rect(`document.querySelector('print-designer').shadowRoot.querySelector('#page-0')`)},
  {label:'保存模板',rect:btn('保存模板')}
]);
await action('await s.saveTemplate({returnToPreview:true});window.__hostControls.pickerIds=["rec001","rec002","rec003"];await s.loadRecords(true);');
await settle();
await pause(2600);
await save('05-batch',[
  {label:'确认已选记录',rect:css('.workspace-heading')},
  {label:'选择排版方式',rect:css('.batch-layout-switch')},
  {label:'导出或打印',rect:(()=>{const a=btn('导出 PDF'),b=btn('打印');return a&&b?{x:a.x,y:a.y,w:b.x+b.w-a.x,h:a.h}:null})()}
]);
await action('await s.changeBatchLayout("labels");await s.enterEditMode();');
await pause(800);
console.log(JSON.stringify(evaluate(tab, `(()=>{const r=document.querySelector('print-designer').shadowRoot;return {text:r.innerText,buttons:[...r.querySelectorAll('button')].map(e=>({text:e.innerText,title:e.title})).filter(x=>x.title||x.text)}})()`)));
await save('06-label-edit',[
  {label:'选择标签排版',rect:css('.batch-layout-switch')},
  {label:'编辑左上角第一格',rect:rect(`document.querySelector('print-designer').shadowRoot.querySelector('#page-0')`)},
  {label:'保存后返回预览',rect:btn('保存模板')}
]);
await action('await s.saveTemplate({returnToPreview:true});');
await settle();
await pause(2600);
await save('07-label-preview',[
  {label:'核对标签内容与位置',rect:css('.preview-paper-size')},
  {label:'打印前先试打一张',rect:btn('打印')}
]);
}
