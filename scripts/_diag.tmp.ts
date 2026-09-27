import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const entries = JSON.parse(await readFile('public/game/appearance.carbon','utf8'));
const images: Map<string, any> = new Map(await Promise.all(entries.map(async (e:any)=>[e.filename,await loadImage(e.data)])));
function strip(name: string, id: number) {
  const img = images.get(name)!, cols = img.width/64, c = createCanvas(960,128), ctx = c.getContext('2d');
  for (let p=0;p<15;p++){const cell=id*15+p;ctx.drawImage(img,cell%cols*64,Math.floor(cell/cols)*128,64,128,p*64,0,64,128);}
  return ctx.getImageData(0,0,960,128).data;
}
const a = (d: Uint8ClampedArray, p: number, x: number, y: number) => d[(y*960+p*64+x)*4+3];
const body = strip('body.png',0), gloves = strip('gloves1.png',0);
for (const [name,id] of [['sword',4],['axe',9],['pick',10],['rod',0],['bow',24],['staff',27]] as const) {
  const w = strip('weapon1.png', id);
  console.log('==',name);
  for (let p=0;p<15;p++){
    const pts:number[][]=[]; for(let y=0;y<128;y++)for(let x=0;x<64;x++) if(a(w,p,x,y)) pts.push([x+.5,y+.5]);
    if(!pts.length){console.log(p,'empty');continue;}
    const n=pts.length, mx=pts.reduce((s,q)=>s+q[0],0)/n, my=pts.reduce((s,q)=>s+q[1],0)/n;
    let sxx=0,syy=0,sxy=0; for(const [x,y] of pts){sxx+=(x-mx)**2;syy+=(y-my)**2;sxy+=(x-mx)*(y-my);}
    const th=0.5*Math.atan2(2*sxy,sxx-syy); // axis angle from x-axis
    const ux=Math.cos(th),uy=Math.sin(th); let lo=1e9,hi=-1e9,wlo=1e9,whi=-1e9;
    for(const [x,y] of pts){const t=(x-mx)*ux+(y-my)*uy, s=-(x-mx)*uy+(y-my)*ux; lo=Math.min(lo,t);hi=Math.max(hi,t);wlo=Math.min(wlo,s);whi=Math.max(whi,s);}
    let deg = th*180/Math.PI; deg = deg>0? deg-90 : deg+90; // angle from vertical; + = clockwise top-right
    // hand: body∩gloves pixels within 3px of weapon
    let hx=0,hy=0,hn=0; for(let y=0;y<128;y++)for(let x=0;x<64;x++) if(a(body,p,x,y)&&a(gloves,p,x,y)){ let near=false; for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy; if(X>=0&&X<64&&Y>=0&&Y<128&&a(w,p,X,Y)){near=true;break;}} if(near){hx+=x;hy+=y;hn++;} }
    console.log(p, 'n',n,'c',mx.toFixed(1),my.toFixed(1),'ang',(-deg).toFixed(1),'len',(hi-lo+1).toFixed(1),'wid',(whi-wlo+1).toFixed(1),'hand',hn?`${(hx/hn).toFixed(1)},${(hy/hn).toFixed(1)} (${hn})`:'-');
  }
}
