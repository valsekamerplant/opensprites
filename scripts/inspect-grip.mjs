import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const entries=JSON.parse(await readFile('public/game/appearance.carbon','utf8'));
const defs=JSON.parse(await readFile('public/game/itemdefs.carbon','utf8'));
const images=new Map(await Promise.all(entries.map(async e=>[e.filename,await loadImage(e.data)])));
console.log(defs.filter(d=>d.name.includes('longsword')||d.equipmentType==='gloves').map(d=>({id:d._id,name:d.name,sprite:d.equipmentSpriteId}))); 
const frame=(ctx,name,id,p,x,y)=>{const img=images.get(name);const cell=id*15+p,cols=img.width/64;ctx.drawImage(img,cell%cols*64,Math.floor(cell/cols)*128,64,128,x,y,64,128);};
const c=createCanvas(960,128*4),ctx=c.getContext('2d');ctx.fillStyle='#314038';ctx.fillRect(0,0,c.width,c.height);
const sword=defs.find(d=>d._id===58);
for(let p=0;p<15;p++){
  for(const name of ['pants.png','body.png'])frame(ctx,name,0,p,p*64,0);
  frame(ctx,'weapon1.png',sword.equipmentSpriteId,p,p*64,0);
  frame(ctx,'weapon1.png',sword.equipmentSpriteId,p,p*64,128);
  frame(ctx,'body.png',0,p,p*64,256);
  frame(ctx,'gloves1.png',0,p,p*64,384);
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/grip-reference.png',c.toBuffer('image/png'));
const detail=createCanvas(64*15,64*3),dc=detail.getContext('2d');
dc.fillStyle='#314038';dc.fillRect(0,0,detail.width,detail.height);
for(let p=0;p<15;p++){
  const swordCanvas=createCanvas(64,128),sc=swordCanvas.getContext('2d');frame(sc,'weapon1.png',sword.equipmentSpriteId,p,0,0);
  const bodyCanvas=createCanvas(64,128),bc=bodyCanvas.getContext('2d');frame(bc,'body.png',0,p,0,0);
  const gloveCanvas=createCanvas(64,128),gc=gloveCanvas.getContext('2d');frame(gc,'gloves1.png',0,p,0,0);
  const a=sc.getImageData(0,0,64,128).data,b=bc.getImageData(0,0,64,128).data,g=gc.getImageData(0,0,64,128).data;
  let body=0,glove=0;for(let i=0;i<a.length;i+=4)if(a[i+3]){if(b[i+3])body++;if(g[i+3])glove++;}console.log('pose',p,'body overlap',body,'glove overlap',glove);
  for(let row=0;row<3;row++){dc.drawImage(bodyCanvas,0,40,64,64,p*64,row*64,64,64);if(row===1)dc.drawImage(gloveCanvas,0,40,64,64,p*64,row*64,64,64);if(row!==1)dc.drawImage(swordCanvas,0,40,64,64,p*64,row*64,64,64);}
}
const zoom=createCanvas(detail.width*2,detail.height*2);zoom.getContext('2d').imageSmoothingEnabled=false;zoom.getContext('2d').drawImage(detail,0,0,zoom.width,zoom.height);await writeFile('artifacts/grip-detail.png',zoom.toBuffer('image/png'));
