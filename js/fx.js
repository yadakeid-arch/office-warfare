/* ============================================================
   OFFICE WARFARE ── 見た目と手触りの強化レイヤー
   game.js より先に読み込む。ゲームのルールや当たり判定には触れない。
   画質「低」のときは、ここの描画まわりはほぼ素通しになる。
   ============================================================ */
window.FX=(function(){
"use strict";

/* ---------- 設定（ブラウザに保存） ---------- */
const LS_KEY="office_warfare_settings_v1";
const S={quality:"high",sens:100,vol:50,fov:74};
try{
  const j=JSON.parse(localStorage.getItem(LS_KEY)||"null");
  if(j) for(const k in S) if(j[k]!=null) S[k]=j[k];
}catch(e){}
let urlQ=null;
try{ urlQ=new URLSearchParams(location.search).get("q"); }catch(e){}
function save(){ try{ localStorage.setItem(LS_KEY,JSON.stringify(S)); }catch(e){} }

const QDEF={
  low :{post:false,lit:false,shadow:false,px:1.5 ,fx:0.6},
  mid :{post:true ,lit:true ,shadow:false,px:1.5 ,fx:1.0},
  high:{post:true ,lit:true ,shadow:true ,px:1.75,fx:1.0}
};
if(!QDEF[S.quality]) S.quality="high";
const Q=Object.assign({},QDEF[urlQ]||QDEF[S.quality]);   // URLの ?q= は一時的な指定で、保存はしない

const api={ambK:1};
let composer=null, bloomPass=null, finalPass=null, fxaaPass=null;
let resScale=1, hdr=false;
let time=0, hurtT=0;

api.pixelRatio=function(){ return Math.min(window.devicePixelRatio||1,Q.px)*resScale; };
api.volume=function(){ return S.vol/100; };
api.setSens=function(v){ S.sens=v; save(); };

/* ============================================================
   レンダラーとポストプロセス
   ============================================================ */
const FinalShader={
  uniforms:{tDiffuse:{value:null},time:{value:0},hurt:{value:0},grain:{value:0.035},vig:{value:0.55}},
  vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
  fragmentShader:[
    "uniform sampler2D tDiffuse; uniform float time,hurt,grain,vig; varying vec2 vUv;",
    "float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }",
    /* 暗部と中間はそのまま通し、明るすぎる所だけなだらかに丸める（暗さの調整を壊さないため） */
    "vec3 shoulder(vec3 c){ const float k=0.62; vec3 h=k+(1.0-k)*(1.0-exp(-(c-k)/(1.0-k))); return mix(c,h,step(k,c)); }",
    "vec3 toSRGB(vec3 c){ return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(0.0031308,c)); }",
    "void main(){",
    "  vec2 d=vUv-0.5; float r2=dot(d,d);",
    "  float ca=0.0006+hurt*0.012;",
    "  vec3 c;",
    "  c.r=texture2D(tDiffuse,vUv+d*r2*ca*6.0).r;",
    "  c.g=texture2D(tDiffuse,vUv).g;",
    "  c.b=texture2D(tDiffuse,vUv-d*r2*ca*6.0).b;",
    "  c=shoulder(max(c,vec3(0.0)));",
    "  float l=dot(c,vec3(0.2126,0.7152,0.0722));",
    "  c=mix(vec3(l),c,1.06);",                                   // 彩度をわずかに
    "  c*=mix(vec3(0.94,0.99,1.06),vec3(1.05,1.0,0.94),smoothstep(0.0,0.5,l));", // 影は冷たく、光は暖かく
    "  c*=1.0-vig*smoothstep(0.10,0.62,r2);",
    "  c.r+=hurt*0.22*smoothstep(0.05,0.5,r2);",
    "  c=toSRGB(clamp(c,0.0,1.0));",
    "  c+=(hash(vUv*vec2(1920.0,1080.0)+fract(time)*61.0)-0.5)*grain;",
    "  gl_FragColor=vec4(c,1.0);",
    "}"].join("\n")
};

api.initRenderer=function(){
  camera.fov=S.fov; camera.updateProjectionMatrix();
  sens=S.sens/1000*0.018;
  const sr=document.getElementById("sensrange"); if(sr) sr.value=S.sens;
  if(Q.shadow){
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  }
  if(Q.post){
    const ok=renderer.capabilities.isWebGL2&&renderer.extensions.get("EXT_color_buffer_float")&&
             THREE.EffectComposer&&THREE.UnrealBloomPass;
    if(!ok) Q.post=false;
  }
  if(Q.post){
    try{
      const sz=renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt=new THREE.WebGLRenderTarget(sz.x,sz.y,{
        minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
        format:THREE.RGBAFormat,type:THREE.HalfFloatType,stencilBuffer:false});
      composer=new THREE.EffectComposer(renderer,rt);
      composer.addPass(new THREE.RenderPass(scene,camera));
      bloomPass=new THREE.UnrealBloomPass(new THREE.Vector2(sz.x/2,sz.y/2),0.62,0.55,0.88);
      composer.addPass(bloomPass);
      finalPass=new THREE.ShaderPass(FinalShader);
      composer.addPass(finalPass);
      fxaaPass=new THREE.ShaderPass(THREE.FXAAShader);
      fxaaPass.material.uniforms.resolution.value.set(1/sz.x,1/sz.y);
      composer.addPass(fxaaPass);
      hdr=true;
      /* 背景色はそのまま画面に出る値なので、後段でsRGBに直されるぶんを打ち消しておく */
      if(scene.background&&scene.background.isColor) scene.background.convertSRGBToLinear();
      /* r128 の霧は色変換の後に混ぜられる。こちらも同じ見た目になるよう色を合わせる */
      if(scene.fog) scene.fog.color.convertSRGBToLinear();
      const v=document.getElementById("vig"); if(v) v.style.opacity="0.35";
    }catch(e){ composer=null; hdr=false; Q.post=false; }
  }
};
api.resize=function(){
  renderer.setPixelRatio(api.pixelRatio());
  renderer.setSize(innerWidth,innerHeight);
  const sz=renderer.getDrawingBufferSize(new THREE.Vector2());
  if(composer){
    composer.setSize(sz.x,sz.y);
    fxaaPass.material.uniforms.resolution.value.set(1/sz.x,1/sz.y);
  }
  for(const ps of systems) ps.mat.uniforms.scale.value=sz.y/(2*Math.tan(camera.fov*Math.PI/360));
  if(motes) motes.material.uniforms.scale.value=sz.y/(2*Math.tan(camera.fov*Math.PI/360));
};

/* ============================================================
   テクスチャ（すべてCanvas生成。画質「中」以上で差し替える）
   ============================================================ */
const BUMP={};
function cv(size,draw){
  const c=document.createElement("canvas"); c.width=c.height=size;
  const g=c.getContext("2d"); draw(g,size); return c;
}
function grainFill(g,s,base,amt){
  g.fillStyle=base; g.fillRect(0,0,s,s);
  const img=g.getImageData(0,0,s,s), d=img.data;
  for(let i=0;i<d.length;i+=4){
    const n=(Math.random()-0.5)*amt;
    d[i]+=n; d[i+1]+=n; d[i+2]+=n;
  }
  g.putImageData(img,0,0);
}
/* つなぎ目の出ない、ぼんやりしたムラ */
function blotch(g,s,n,rmin,rmax,color,alpha){
  for(let i=0;i<n;i++){
    const x=Math.random()*s, y=Math.random()*s, r=rmin+Math.random()*(rmax-rmin);
    for(const ox of [-s,0,s]) for(const oy of [-s,0,s]){
      if(x+ox+r<0||x+ox-r>s||y+oy+r<0||y+oy-r>s) continue;
      const gr=g.createRadialGradient(x+ox,y+oy,0,x+ox,y+oy,r);
      gr.addColorStop(0,color.replace("A",String(alpha*(0.4+Math.random()*0.6))));
      gr.addColorStop(1,color.replace("A","0"));
      g.fillStyle=gr; g.fillRect(x+ox-r,y+oy-r,r*2,r*2);
    }
  }
}
function tex(c,rx,ry,srgb){
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rx,ry);
  if(srgb) t.encoding=THREE.sRGBEncoding;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return t;
}
api.textures=function(TEX){
  if(!Q.lit) return;
  /* 壁：塗り壁のムラ＋天井ぎわと床ぎわの陰り＋巾木 */
  TEX.wall=tex(cv(512,(g,s)=>{
    grainFill(g,s,"#8d8a82",20);
    blotch(g,s,26,40,150,"rgba(70,66,58,A)",0.10);
    blotch(g,s,14,30,110,"rgba(190,186,176,A)",0.07);
    g.globalAlpha=.07; g.fillStyle="#4a463f";
    for(let i=0;i<46;i++){ const x=Math.random()*s; g.fillRect(x,Math.random()*s*0.5,1+Math.random()*2,s); }
    g.globalAlpha=1;
    let gr=g.createLinearGradient(0,0,0,s*0.10);
    gr.addColorStop(0,"rgba(18,17,16,.50)"); gr.addColorStop(1,"rgba(18,17,16,0)");
    g.fillStyle=gr; g.fillRect(0,0,s,s*0.10);
    gr=g.createLinearGradient(0,s*0.80,0,s);
    gr.addColorStop(0,"rgba(18,17,16,0)"); gr.addColorStop(1,"rgba(18,17,16,.42)");
    g.fillStyle=gr; g.fillRect(0,s*0.80,s,s*0.20);
    g.fillStyle="#3b3934"; g.fillRect(0,s*0.966,s,s*0.034);
    g.fillStyle="rgba(255,255,255,.10)"; g.fillRect(0,s*0.966,s,2);
  }),4,1,true);
  BUMP.wall=tex(cv(256,(g,s)=>{ grainFill(g,s,"#808080",46); blotch(g,s,18,10,40,"rgba(255,255,255,A)",0.16); }),8,2,false);

  /* 床：50cm角のタイルカーペット */
  TEX.carpet=tex(cv(512,(g,s)=>{
    grainFill(g,s,"#3b3a3f",30);
    const n=4, w=s/n;
    for(let i=0;i<n;i++) for(let j=0;j<n;j++){
      const v=Math.random();
      g.fillStyle=v<0.5?"rgba(0,0,0,"+(0.05+v*0.16)+")":"rgba(120,120,135,"+((v-0.5)*0.12)+")";
      g.fillRect(i*w,j*w,w,w);
      g.globalAlpha=.10; g.fillStyle="#1d1d24";
      if((i+j)%2===0) for(let k=0;k<w;k+=4) g.fillRect(i*w,j*w+k,w,1.5);
      else for(let k=0;k<w;k+=4) g.fillRect(i*w+k,j*w,1.5,w);
      g.globalAlpha=1;
    }
    g.fillStyle="rgba(10,10,14,.55)";
    for(let i=0;i<n;i++){ g.fillRect(i*w,0,1.5,s); g.fillRect(0,i*w,s,1.5); }
    blotch(g,s,10,30,120,"rgba(15,14,16,A)",0.20);
  }),14,9,true);
  BUMP.carpet=tex(cv(256,(g,s)=>{ grainFill(g,s,"#808080",120); }),56,36,false);

  /* 天井：岩綿吸音板 */
  TEX.ceil=tex(cv(512,(g,s)=>{
    grainFill(g,s,"#b9b6ad",12);
    g.fillStyle="rgba(60,58,54,.30)";
    for(let i=0;i<2600;i++) g.fillRect(Math.random()*s,Math.random()*s,1+Math.random()*1.6,1+Math.random()*1.6);
    const n=3, w=s/n;
    for(let i=0;i<n;i++) for(let j=0;j<n;j++){
      g.fillStyle="rgba(0,0,0,"+(Math.random()*0.06)+")"; g.fillRect(i*w,j*w,w,w);
    }
    g.strokeStyle="rgba(52,50,46,.75)"; g.lineWidth=3;
    for(let i=0;i<=n;i++){
      g.beginPath(); g.moveTo(i*w,0); g.lineTo(i*w,s); g.stroke();
      g.beginPath(); g.moveTo(0,i*w); g.lineTo(s,i*w); g.stroke();
    }
    blotch(g,s,4,30,90,"rgba(96,82,50,A)",0.10);
  }),14,9,true);

  /* コンクリート */
  TEX.concrete=tex(cv(512,(g,s)=>{
    grainFill(g,s,"#6e6e6b",26);
    blotch(g,s,30,30,160,"rgba(40,40,38,A)",0.16);
    blotch(g,s,18,20,120,"rgba(150,150,146,A)",0.10);
    g.strokeStyle="rgba(30,30,28,.35)"; g.lineWidth=1;
    for(let i=0;i<7;i++){
      let x=Math.random()*s, y=Math.random()*s;
      g.beginPath(); g.moveTo(x,y);
      for(let k=0;k<9;k++){ x+=(Math.random()-0.5)*46; y+=10+Math.random()*26; g.lineTo(x,y); }
      g.stroke();
    }
    g.fillStyle="rgba(30,30,28,.5)";
    for(let i=0;i<4;i++) for(let j=0;j<2;j++){
      g.beginPath(); g.arc((i+0.5)*s/4,(j+0.5)*s/2,3.2,0,Math.PI*2); g.fill();
    }
    g.globalAlpha=.10; g.fillStyle="#2a2a28";
    for(let i=0;i<10;i++){ const x=Math.random()*s; g.fillRect(x,0,2+Math.random()*5,s*(0.3+Math.random()*0.7)); }
    g.globalAlpha=1;
  }),3,2,true);
  BUMP.concrete=tex(cv(256,(g,s)=>{ grainFill(g,s,"#808080",70); blotch(g,s,30,6,30,"rgba(0,0,0,A)",0.30); }),6,4,false);

  /* 金属：ヘアライン */
  TEX.metal=tex(cv(256,(g,s)=>{
    grainFill(g,s,"#7a7f85",10);
    for(let i=0;i<s;i++){
      g.fillStyle="rgba("+(Math.random()<0.5?"255,255,255":"30,34,40")+","+(Math.random()*0.10)+")";
      g.fillRect(0,i,s,1);
    }
    blotch(g,s,6,30,90,"rgba(40,44,50,A)",0.16);
  }),1,1,true);

  /* 木目 */
  TEX.wood=tex(cv(256,(g,s)=>{
    grainFill(g,s,"#6b5136",14);
    for(let i=0;i<70;i++){
      const y=Math.random()*s, a=0.05+Math.random()*0.16;
      g.strokeStyle=(Math.random()<0.7?"rgba(58,40,22,":"rgba(150,118,80,")+a+")";
      g.lineWidth=0.6+Math.random()*1.8;
      g.beginPath(); g.moveTo(0,y);
      const amp=2+Math.random()*5, ph=Math.random()*6.3;
      for(let x=0;x<=s;x+=16) g.lineTo(x,y+Math.sin(x/s*Math.PI*2+ph)*amp);
      g.stroke();
    }
  }),1,1,true);

  /* 外まわりの地面 */
  TEX.asphalt=tex(cv(256,(g,s)=>{
    grainFill(g,s,"#232629",30);
    g.fillStyle="rgba(120,124,128,.35)";
    for(let i=0;i<500;i++) g.fillRect(Math.random()*s,Math.random()*s,1,1);
    blotch(g,s,10,20,80,"rgba(8,9,10,A)",0.25);
  }),30,30,true);
};

/* ============================================================
   マテリアル（Lambert は頂点単位の計算なので、ピクセル単位の Phong に替える。
   懐中電灯や発砲の光が、壁や床にきちんと円く落ちるようになる）
   ============================================================ */
api.materials=function(MAT,TEX){
  if(hdr){
    MAT.lampOn.color.multiplyScalar(2.3);
    MAT.emerg.color.multiplyScalar(1.9);
    MAT.eye.color.multiplyScalar(1.8);
  }
  if(!Q.lit) return;
  const SPEC={
    wall:[0x161616,10,BUMP.wall,0.006], wallDark:[0x141414,10,BUMP.wall,0.006],
    floor:[0x050505,4,BUMP.carpet,0.010], ceil:[0x0a0a0a,6,null,0],
    concrete:[0x181818,14,BUMP.concrete,0.012], metal:[0x8a8f96,46,null,0],
    wood:[0x2c2620,26,null,0], door:[0x2a2824,22,null,0], doorLock:[0x2a2824,22,null,0],
    dark:[0x20232a,30,null,0], glass:[0xffffff,90,null,0],
    asphalt:[0x101010,8,null,0], roof:[0x161616,10,BUMP.concrete,0.012],
    roofWall:[0x161616,10,BUMP.concrete,0.012]
  };
  for(const k in SPEC){
    const o=MAT[k]; if(!o) continue;
    const s=SPEC[k];
    const m=new THREE.MeshPhongMaterial({
      map:o.map||null,color:o.color.getHex(),emissive:o.emissive?o.emissive.getHex():0,
      specular:s[0],shininess:s[1],transparent:o.transparent,opacity:o.opacity});
    if(s[2]){ m.bumpMap=s[2]; m.bumpScale=s[3]; }
    MAT[k]=m;
  }
  api.ambK=0.62;       // 天井の照明を実際の光源にするぶん、環境光を引く
};

/* ============================================================
   パーティクル
   ============================================================ */
const systems=[];
let dotTex=null;
function softDot(){
  return new THREE.CanvasTexture(cv(64,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,"rgba(255,255,255,1)"); gr.addColorStop(0.35,"rgba(255,255,255,.55)");
    gr.addColorStop(1,"rgba(255,255,255,0)");
    g.fillStyle=gr; g.fillRect(0,0,s,s);
  }));
}
function PS(max,additive){
  this.max=max; this.n=0;
  this.pos=new Float32Array(max*3); this.vel=new Float32Array(max*3);
  this.col=new Float32Array(max*4); this.size=new Float32Array(max);
  this.life=new Float32Array(max); this.maxLife=new Float32Array(max);
  this.grav=new Float32Array(max); this.drag=new Float32Array(max);
  this.grow=new Float32Array(max); this.a0=new Float32Array(max); this.floor=new Float32Array(max);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(this.pos,3));
  g.setAttribute("col",new THREE.BufferAttribute(this.col,4));
  g.setAttribute("size",new THREE.BufferAttribute(this.size,1));
  this.mat=new THREE.ShaderMaterial({
    uniforms:{map:{value:dotTex},scale:{value:600},lit:{value:1}},
    vertexShader:"attribute float size; attribute vec4 col; varying vec4 vCol; uniform float scale;"+
      "void main(){ vCol=col; vec4 mv=modelViewMatrix*vec4(position,1.0);"+
      " gl_PointSize=size*scale/max(0.05,-mv.z); gl_Position=projectionMatrix*mv; }",
    fragmentShader:"uniform sampler2D map; uniform float lit; varying vec4 vCol;"+
      "void main(){ float a=texture2D(map,gl_PointCoord).a*vCol.a; if(a<0.004) discard;"+
      " gl_FragColor=vec4(vCol.rgb*lit,a); }",
    transparent:true,depthWrite:false,
    blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
  this.mesh=new THREE.Points(g,this.mat);
  this.mesh.frustumCulled=false; this.mesh.renderOrder=additive?6:5;
  scene.add(this.mesh);
  systems.push(this);
}
PS.prototype.emit=function(x,y,z,vx,vy,vz,r,g,b,a,size,life,grav,drag,grow,floorY){
  const i=this.n; this.n=(this.n+1)%this.max;
  this.pos[i*3]=x; this.pos[i*3+1]=y; this.pos[i*3+2]=z;
  this.vel[i*3]=vx; this.vel[i*3+1]=vy; this.vel[i*3+2]=vz;
  this.col[i*4]=r; this.col[i*4+1]=g; this.col[i*4+2]=b; this.col[i*4+3]=a;
  this.a0[i]=a; this.size[i]=size; this.life[i]=life; this.maxLife[i]=life;
  this.grav[i]=grav||0; this.drag[i]=drag||0; this.grow[i]=grow||0;
  this.floor[i]=(floorY==null)?-1e9:floorY;
};
PS.prototype.update=function(dt){
  let any=false;
  for(let i=0;i<this.max;i++){
    if(this.life[i]<=0) continue;
    any=true;
    this.life[i]-=dt;
    if(this.life[i]<=0){ this.size[i]=0; this.col[i*4+3]=0; continue; }
    const d=Math.max(0,1-this.drag[i]*dt);
    this.vel[i*3]*=d; this.vel[i*3+1]=this.vel[i*3+1]*d-this.grav[i]*dt; this.vel[i*3+2]*=d;
    this.pos[i*3]+=this.vel[i*3]*dt; this.pos[i*3+1]+=this.vel[i*3+1]*dt; this.pos[i*3+2]+=this.vel[i*3+2]*dt;
    if(this.pos[i*3+1]<this.floor[i]){
      this.pos[i*3+1]=this.floor[i]; this.vel[i*3+1]*=-0.35; this.vel[i*3]*=0.6; this.vel[i*3+2]*=0.6;
    }
    this.size[i]+=this.grow[i]*dt;
    const k=this.life[i]/this.maxLife[i];
    this.col[i*4+3]=this.a0[i]*(k<0.6?k/0.6:1);
  }
  const at=this.mesh.geometry.attributes;
  if(any||this.dirty){ at.position.needsUpdate=true; at.col.needsUpdate=true; at.size.needsUpdate=true; }
  this.dirty=any;
};
let sparks=null, smoke=null;
const rnd=(a)=>(Math.random()-0.5)*2*a;

/* 着弾：火花と粉じん */
function impactFx(p,n,amount){
  const k=Q.fx*(amount||1);
  const ns=Math.round(7*k), nd=Math.round(3*k);
  for(let i=0;i<ns;i++){
    const sp=2.0+Math.random()*4.5;
    sparks.emit(p.x,p.y,p.z, n.x*sp+rnd(2.2),n.y*sp+rnd(2.2)+0.8,n.z*sp+rnd(2.2),
      hdr?5.0:1.0,hdr?3.0:0.75,hdr?1.1:0.35,1, 0.022+Math.random()*0.02, 0.16+Math.random()*0.22, 9, 1.2, 0);
  }
  for(let i=0;i<nd;i++){
    smoke.emit(p.x+n.x*0.05,p.y+n.y*0.05,p.z+n.z*0.05, n.x*0.7+rnd(0.35),n.y*0.7+rnd(0.3)+0.25,n.z*0.7+rnd(0.35),
      0.62,0.60,0.56,0.30, 0.10+Math.random()*0.08, 0.6+Math.random()*0.5, -0.15, 2.6, 0.55);
  }
}
/* 命中：赤い飛沫 */
function bodyFx(x,y,z,dx,dz,big){
  const k=Q.fx*(big?1.8:1);
  for(let i=0;i<Math.round(9*k);i++){
    smoke.emit(x+rnd(0.1),y+rnd(0.18),z+rnd(0.1), dx*1.6+rnd(1.6),0.6+Math.random()*1.8,dz*1.6+rnd(1.6),
      0.46,0.035,0.03,0.85, 0.035+Math.random()*0.035, 0.45+Math.random()*0.4, 7.5, 0.8, 0);
  }
  for(let i=0;i<Math.round(3*k);i++){
    smoke.emit(x,y,z, dx*0.5+rnd(0.4),0.2+rnd(0.3),dz*0.5+rnd(0.4),
      0.34,0.05,0.05,0.34, 0.16, 0.5, 0, 2.5, 0.7);
  }
}

/* ---------- 弾痕 ---------- */
const DECAL_N=56; let decals=[], decalI=0, decalGeo=null, decalMat=null;
function initDecals(){
  const t=new THREE.CanvasTexture(cv(64,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,"rgba(0,0,0,1)"); gr.addColorStop(0.22,"rgba(0,0,0,.95)");
    gr.addColorStop(0.40,"rgba(20,18,16,.45)"); gr.addColorStop(1,"rgba(20,18,16,0)");
    g.fillStyle=gr; g.fillRect(0,0,s,s);
    g.strokeStyle="rgba(0,0,0,.5)"; g.lineWidth=1;
    for(let i=0;i<7;i++){
      const a=Math.random()*6.3, r=s*(0.16+Math.random()*0.26);
      g.beginPath(); g.moveTo(s/2,s/2); g.lineTo(s/2+Math.cos(a)*r,s/2+Math.sin(a)*r); g.stroke();
    }
  }));
  decalGeo=new THREE.PlaneGeometry(1,1);
  decalMat=new THREE.MeshBasicMaterial({map:t,color:0x0a0a0a,transparent:true,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
}
const _dn=new THREE.Vector3(), _dp=new THREE.Vector3(), _dz=new THREE.Vector3(0,0,1), _dq=new THREE.Quaternion();
function addDecal(hit){
  if(!hit.face||!hit.object) return;
  let d=decals[decalI];
  if(!d){ d=new THREE.Mesh(decalGeo,decalMat); d.renderOrder=3; d.userData._sh=1; decals[decalI]=d; }
  decalI=(decalI+1)%DECAL_N;
  if(d.parent) d.parent.remove(d);
  _dn.copy(hit.face.normal);
  _dp.copy(hit.point); hit.object.worldToLocal(_dp);
  _dp.addScaledVector(_dn,0.004);
  d.position.copy(_dp);
  _dq.setFromUnitVectors(_dz,_dn); d.quaternion.copy(_dq);
  d.rotateZ(Math.random()*6.3);
  const s=0.10+Math.random()*0.05; d.scale.set(s,s,s);
  hit.object.add(d);
}

/* ---------- 薬莢 ---------- */
const shells=[]; let shellI=0;
function initShells(){
  const geo=new THREE.CylinderGeometry(0.006,0.006,0.022,6);
  const mat=new THREE.MeshLambertMaterial({color:0xc9a24a,emissive:0x3a2c0c});
  for(let i=0;i<10;i++){
    const m=new THREE.Mesh(geo,mat); m.visible=false; m.userData._sh=1; scene.add(m);
    shells.push({m:m,v:new THREE.Vector3(),t:0,fy:0,w:new THREE.Vector3()});
  }
}
const _sv=new THREE.Vector3(), _sr=new THREE.Vector3();
function ejectShell(sg){
  const s=shells[shellI]; shellI=(shellI+1)%shells.length;
  _sv.set(0.24,-0.11,-0.42); camera.localToWorld(_sv);
  s.m.position.copy(_sv); s.m.visible=true; s.m.scale.setScalar(sg?2.2:1);
  _sr.set(1,0,0).applyQuaternion(camera.quaternion);
  s.v.set(_sr.x*(1.6+Math.random()),2.0+Math.random()*0.8,_sr.z*(1.6+Math.random()));
  s.w.set(rnd(18),rnd(18),rnd(18));
  s.t=1.8; s.fy=player.pos.y+0.012;
}
function updateShells(dt){
  for(const s of shells){
    if(s.t<=0) continue;
    s.t-=dt;
    if(s.t<=0){ s.m.visible=false; continue; }
    s.v.y-=11*dt;
    s.m.position.addScaledVector(s.v,dt);
    s.m.rotation.x+=s.w.x*dt; s.m.rotation.z+=s.w.z*dt;
    if(s.m.position.y<s.fy){
      s.m.position.y=s.fy;
      if(Math.abs(s.v.y)>0.8&&typeof tone==="function") tone("triangle",3400+Math.random()*900,2600,0.05,0.012);
      s.v.y*=-0.38; s.v.x*=0.5; s.v.z*=0.5; s.w.multiplyScalar(0.5);
    }
  }
}

/* ---------- 銃口の閃光 ---------- */
let mflash=null, mflashT=0, mflashSeen=false;
function initMuzzle(){
  const t=new THREE.CanvasTexture(cv(128,(g,s)=>{
    g.translate(s/2,s/2);
    const gr=g.createRadialGradient(0,0,0,0,0,s/2);
    gr.addColorStop(0,"rgba(255,250,230,1)"); gr.addColorStop(0.18,"rgba(255,214,130,.85)");
    gr.addColorStop(0.5,"rgba(255,150,50,.25)"); gr.addColorStop(1,"rgba(255,120,30,0)");
    g.fillStyle=gr; g.fillRect(-s/2,-s/2,s,s);
    g.fillStyle="rgba(255,236,190,.9)";
    for(let i=0;i<5;i++){
      g.rotate(Math.PI*2/5+rnd(0.2));
      g.beginPath(); g.moveTo(0,-3); g.lineTo(s*0.46,0); g.lineTo(0,3); g.closePath(); g.fill();
    }
  }));
  const m=new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    fog:false,color:hdr?new THREE.Color(3.2,2.6,1.8):new THREE.Color(1,1,1)});
  mflash=new THREE.Mesh(new THREE.PlaneGeometry(1,1),m);
  mflash.position.set(0.20,-0.125,-0.78); mflash.visible=false; mflash.renderOrder=8; mflash.userData._sh=1;
  camera.add(mflash);
}

/* ---------- 懐中電灯に浮かぶ埃 ---------- */
let motes=null;
function initMotes(){
  const N=Math.round(260*Q.fx), pos=new Float32Array(N*3);
  for(let i=0;i<N*3;i++) pos[i]=Math.random()*10;
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));
  motes=new THREE.Points(g,new THREE.ShaderMaterial({
    uniforms:{cam:{value:new THREE.Vector3()},dir:{value:new THREE.Vector3()},t:{value:0},
              scale:{value:600},power:{value:0},map:{value:dotTex}},
    vertexShader:"uniform vec3 cam,dir; uniform float t,scale; varying float vA;"+
      "void main(){ vec3 p=position+vec3(sin(t*0.21+position.y*3.0)*0.25,t*0.035,cos(t*0.17+position.x*3.0)*0.25);"+
      " p=mod(p-cam+5.0,10.0)-5.0+cam; vec3 v=p-cam; float d=length(v);"+
      " float c=dot(v/max(d,0.001),dir);"+
      " vA=smoothstep(0.86,0.965,c)*smoothstep(7.0,2.0,d)*smoothstep(0.5,1.2,d);"+
      " vec4 mv=viewMatrix*vec4(p,1.0); gl_PointSize=0.014*scale/max(0.05,-mv.z); gl_Position=projectionMatrix*mv; }",
    fragmentShader:"uniform sampler2D map; uniform float power; varying float vA;"+
      "void main(){ float a=texture2D(map,gl_PointCoord).a*vA*power; if(a<0.004) discard; gl_FragColor=vec4(1.0,0.94,0.80,a); }",
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  motes.frustumCulled=false; motes.renderOrder=4;
  scene.add(motes);
}

/* ============================================================
   天井照明を実際の光源に（プレイヤーのいる階へ6灯を使い回す）
   ============================================================ */
const lamps=[]; let lampY=0;
const LAMP_SPOTS=[[-7,0,13,0.40],[7,0,13,0.40],[-7,5.75,11,0.38],[7,5.75,11,0.38],[-7,-5.75,11,0.38],[7,-5.75,11,0.38]];
function initLamps(){
  if(!Q.lit) return;
  /* 部屋にも照明器具を足す（見た目だけ。点灯状態は廊下の蛍光灯と同じ扱い） */
  for(let fi=0;fi<FLOORS;fi++){
    const y=fi*FH;
    const spots=(fi===0)?[[-7,-5.75],[7,-5.75]]:[[-7,5.75],[7,5.75],[-7,-5.75],[7,-5.75]];
    for(const s of spots){
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(1.6,0.06,0.5),flags.lightsOn?MAT.lampOn:MAT.lampOff);
      lamp.position.set(s[0],y+CEIL-0.05,s[1]); lamp.userData._sh=1; scene.add(lamp);
      ceilLamps.push({lamp:lamp,y:y});
    }
  }
  for(const s of LAMP_SPOTS){
    const l=new THREE.PointLight(0xfff1dc,0,s[2],1.5);
    l.position.set(s[0],CEIL-0.45,s[1]); scene.add(l);
    lamps.push({l:l,k:s[3]});
  }
}
function updateLamps(dt){
  if(!lamps.length) return;
  const py=player.pos.y;
  const inside=(py>-2&&py<ROOF_Y-1.0);
  const fi=Math.max(0,Math.min(FLOORS-1,Math.round(py/FH)));
  const on=(started&&inside&&flags.lightsOn)?1:0;
  const ty=fi*FH;
  if(Math.abs(ty-lampY)>FH*1.5) lampY=ty; else lampY+=(ty-lampY)*Math.min(1,dt*7);
  for(const o of lamps){
    o.l.intensity+=(on*o.k-o.l.intensity)*Math.min(1,dt*3);
    o.l.position.y=lampY+CEIL-0.45;
  }
}

/* ============================================================
   影（画質「高」のみ。懐中電灯が影を落とす）
   ============================================================ */
let shT=0;
function sweepShadows(){
  scene.traverse(o=>{
    if(!o.isMesh||o.userData._sh) return;
    o.userData._sh=1;
    let p=o; while(p){ if(p===camera||p===skyGroup) return; p=p.parent; }
    const m=Array.isArray(o.material)?o.material[0]:o.material;
    if(!m||m.isMeshBasicMaterial) return;
    o.receiveShadow=true;
    o.castShadow=!m.transparent;
  });
}

/* ============================================================
   銃の揺れ（視点の動きに少し遅れてついてくる）
   ============================================================ */
let vm=null, lastYaw=0, lastPitch=0, swayX=0, swayY=0, kick=0;
function initViewModel(){
  vm=new THREE.Group(); camera.add(vm);
  vm.add(viewGun); if(viewSG) vm.add(viewSG);
}
function updateViewModel(dt){
  if(!vm) return;
  let dy=player.yaw-lastYaw, dp=player.pitch-lastPitch;
  lastYaw=player.yaw; lastPitch=player.pitch;
  if(dy>Math.PI) dy-=Math.PI*2; if(dy<-Math.PI) dy+=Math.PI*2;
  const k=Math.min(1,dt*10);
  swayX+=(Math.max(-0.05,Math.min(0.05,dy*0.9))-swayX)*k;
  swayY+=(Math.max(-0.04,Math.min(0.04,dp*0.9))-swayY)*k;
  const moving=keysHeld["KeyW"]||keysHeld["KeyA"]||keysHeld["KeyS"]||keysHeld["KeyD"]||
               keysHeld["ArrowUp"]||keysHeld["ArrowDown"]||keysHeld["ArrowLeft"]||keysHeld["ArrowRight"];
  const run=moving&&(keysHeld["ShiftLeft"]||keysHeld["ShiftRight"])&&!crouch&&player.stam>1;
  const amp=moving?(run?0.011:0.006):0;
  const bx=Math.cos(player.bob*0.5)*amp, by=-Math.abs(Math.sin(player.bob*0.5))*amp;
  const br=Math.sin(time*1.7)*0.0016;                    // 呼吸
  kick=Math.max(0,kick-dt*7);
  vm.position.x+=((swayX*0.6+bx)-vm.position.x)*k;
  vm.position.y+=((-swayY*0.5+by+br-(run?0.022:0))-vm.position.y)*k;
  vm.position.z=kick*0.012;
  vm.rotation.y+=((swayX*1.4)-vm.rotation.y)*k;
  vm.rotation.x+=((swayY*1.2+(run?-0.10:0))-vm.rotation.x)*k;
  vm.rotation.z+=((swayX*-1.6+(run?0.12:0))-vm.rotation.z)*k;
}

/* ============================================================
   アバターの造形（箱人間に装備を足す。当たり判定の外形は変えない）
   ============================================================ */
api.avatar=function(slot,core,legs,arms,body,dark){
  const blk=new THREE.MeshLambertMaterial({color:0x17191d,emissive:0x050506});
  const gear=new THREE.MeshLambertMaterial({color:0x2b2e33,emissive:0x08090a});
  const add=(parent,w,h,d,x,y,z,m)=>{
    const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); o.position.set(x,y,z); parent.add(o); return o;
  };
  add(core,0.34,0.13,0.35, 0,1.765,0.005,gear);            // ヘルメット
  add(core,0.36,0.035,0.37, 0,1.705,0.005,blk);            // つば
  add(core,0.12,0.10,0.20, 0,1.44,0,dark);                 // 首
  add(core,0.56,0.40,0.34, 0,1.22,0,gear);                 // ベスト
  add(core,0.20,0.12,0.05, -0.13,1.20,-0.185,blk);         // ポーチ
  add(core,0.20,0.12,0.05, 0.13,1.20,-0.185,blk);
  add(core,0.36,0.40,0.14, 0,1.20,0.21,blk);               // バックパック
  add(core,0.47,0.07,0.31, 0,0.91,0,blk);                  // ベルト
  for(const s of [-1,1]) add(core,0.18,0.07,0.22, s*0.34,1.47,0,gear);   // 肩
  for(const lg of legs){
    add(lg,0.20,0.15,0.26, 0,-0.70,-0.02,blk);             // ブーツ
    add(lg,0.19,0.10,0.05, 0,-0.33,-0.115,gear);           // 膝あて
  }
  for(const ag of arms) add(ag,0.155,0.13,0.175, 0,-0.52,0,blk);   // 手袋
};

/* ============================================================
   ゾンビ・ボスの質感
   元のテクスチャは512pxで法線マップも無いので、読み込み時に
   2倍へ拡大して輪郭を立て、明暗から凹凸（法線マップ）を作る。
   あわせて個体ごとに色味と背丈を少し変え、同じ顔の行列に見えないようにする
   ============================================================ */
function enhanceTexture(src){
  const im=src.image; if(!im||!im.width) return null;
  const W=Math.min(1024,im.width*2), H=Math.min(1024,im.height*2);
  const c=document.createElement("canvas"); c.width=W; c.height=H;
  const g=c.getContext("2d");
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high";
  g.drawImage(im,0,0,W,H);
  const id=g.getImageData(0,0,W,H), d=id.data, n=W*H;
  const lum=new Float32Array(n);
  for(let i=0;i<n;i++) lum[i]=(d[i*4]*0.299+d[i*4+1]*0.587+d[i*4+2]*0.114)/255;
  /* 輪郭を立てる（アンシャープマスク） */
  const out=new Uint8ClampedArray(d.length);
  for(let y=0;y<H;y++){
    const y0=(y?y-1:y)*W, y1=y*W, y2=(y<H-1?y+1:y)*W;
    for(let x=0;x<W;x++){
      const x0=x?x-1:x, x2=x<W-1?x+1:x, o=(y1+x)*4;
      for(let k=0;k<3;k++){
        const b=(d[(y0+x0)*4+k]+d[(y0+x)*4+k]+d[(y0+x2)*4+k]+d[(y1+x0)*4+k]+d[o+k]+
                 d[(y1+x2)*4+k]+d[(y2+x0)*4+k]+d[(y2+x)*4+k]+d[(y2+x2)*4+k])/9;
        out[o+k]=d[o+k]+(d[o+k]-b)*1.1;
      }
      out[o+3]=d[o+3];
    }
  }
  /* 明暗から法線マップ */
  const nc=document.createElement("canvas"); nc.width=W; nc.height=H;
  const ng=nc.getContext("2d"), nid=ng.createImageData(W,H), nd=nid.data, K=2.6;
  for(let y=0;y<H;y++){
    const ya=(y?y-1:y)*W, yb=(y<H-1?y+1:y)*W, y1=y*W;
    for(let x=0;x<W;x++){
      const xa=x?x-1:x, xb=x<W-1?x+1:x;
      let nx=-(lum[y1+xb]-lum[y1+xa])*K, ny=-(lum[yb+x]-lum[ya+x])*K;
      const l=1/Math.sqrt(nx*nx+ny*ny+1), o=(y1+x)*4;
      nd[o]=(nx*l*0.5+0.5)*255; nd[o+1]=(ny*l*0.5+0.5)*255; nd[o+2]=(l*0.5+0.5)*255; nd[o+3]=255;
    }
  }
  id.data.set(out); g.putImageData(id,0,0); ng.putImageData(nid,0,0);
  const mk=(cv,srgb)=>{
    const t=new THREE.CanvasTexture(cv);
    t.flipY=src.flipY; t.wrapS=src.wrapS; t.wrapT=src.wrapT;
    if(srgb) t.encoding=THREE.sRGBEncoding;
    t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  return {map:mk(c,true),normal:mk(nc,false)};
}
let zSpecTex=null;
function zombieSpec(){
  if(!zSpecTex){
    zSpecTex=new THREE.TextureLoader().load("assets/models/zombie_spec.jpg");
    zSpecTex.flipY=false; zSpecTex.wrapS=zSpecTex.wrapT=THREE.RepeatWrapping;
  }
  return zSpecTex;
}
api.skinMat=function(m,orig){
  if(m.map) m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  if(!Q.lit) return m;
  try{
    const p=new THREE.MeshPhongMaterial({
      map:m.map,color:m.color.clone(),skinning:true,side:m.side,
      transparent:m.transparent,alphaTest:m.alphaTest,depthWrite:m.depthWrite,
      specular:0x3a3030,shininess:22});
    if(orig&&orig.normalMap){
      /* 元モデルに法線マップがある場合はそれを使う */
      p.normalMap=orig.normalMap;
      if(orig.normalScale) p.normalScale.copy(orig.normalScale);
      if(orig.name==="body_M"&&!m.transparent){
        p.specularMap=zombieSpec(); p.specular.setHex(0xc8beb4); p.shininess=42;   // 血で濡れた所だけ光る
      }
    }else if(m.map&&!m.transparent){
      const e=enhanceTexture(m.map);
      if(e){ p.map=e.map; p.normalMap=e.normal; p.normalScale=new THREE.Vector2(0.45,0.45); }
    }
    return p;
  }catch(e){ return m; }
};
const ZTINT=[[1,1,1],[0.80,0.93,0.80],[0.70,0.71,0.78],[1.0,0.84,0.78],[0.82,0.88,1.0],[0.92,0.90,0.72]];
api.zombieVariant=function(inst,id){
  let h=(typeof id==="number"?id:0)*2654435761>>>0;
  const vi=h%ZTINT.length, t=ZTINT[vi];
  const tall=0.94+((h>>>8)%100)/100*0.12, wide=0.95+((h>>>16)%100)/100*0.12;
  inst.scale.x*=wide; inst.scale.z*=wide; inst.scale.y*=tall;
  if(vi===0) return;
  inst.traverse(o=>{
    if(!o.isMesh) return;
    const src=o.material; if(!src||!src.color) return;
    const vs=src.userData._var||(src.userData._var={});
    if(!vs[vi]){ const c=src.clone(); c.color.setRGB(src.color.r*t[0],src.color.g*t[1],src.color.b*t[2]); vs[vi]=c; }
    o.material=vs[vi];
  });
};

/* ============================================================
   ゾンビのアニメーション
   通報前＝歩き／通報後に追ってくるとき＝走り／目の前＝噛みつき／倒した時＝倒れ込み
   ============================================================ */
let ZCLIP=null;
const WALK_V=0.33, RUN_V=3.05;          // 各アニメが本来進む速さ（m/秒）
api.zombieClips=function(anims){
  ZCLIP={};
  for(const a of anims||[]) if(a&&a.name) ZCLIP[a.name.toLowerCase()]=a;
};
api.zombieAttach=function(z,inst){
  if(!ZCLIP||!ZCLIP.walk||!ZCLIP.idle) return false;
  const mixer=new THREE.AnimationMixer(inst), A={};
  for(const k of ["idle","walk","run","bite","death"]) if(ZCLIP[k]) A[k]=mixer.clipAction(ZCLIP[k]);
  if(A.death){ A.death.setLoop(THREE.LoopOnce,1); A.death.clampWhenFinished=true; }
  z.an={mixer:mixer,A:A,cur:null,v:0.4,lx:z.pos.x,lz:z.pos.z,biteT:0,first:true};
  zPlay(z,"walk",0);
  mixer.update(0);
  return true;
};
function zPlay(z,name,fade){
  const an=z.an;
  if(an.cur===name||!an.A[name]) return;
  const next=an.A[name], prev=an.cur?an.A[an.cur]:null;
  next.reset(); next.setEffectiveTimeScale(1); next.setEffectiveWeight(1);
  if(name==="walk"||name==="run"||name==="idle") next.time=Math.random()*next.getClip().duration;  // 足並みをそろえない
  if(prev&&fade>0){ next.play(); prev.crossFadeTo(next,fade,false); }
  else{ if(prev) prev.stop(); next.play(); }
  an.cur=name;
}
function zNearPlayer(z){
  let best=1e9;
  for(let i=0;i<MAXP;i++){
    const p=P[i]; if(!p.used||!p.alive||p.dn>0||p.down>0) continue;
    const q=(i===net.mySlot)?player.pos:p;
    if(i!==net.mySlot&&!p.init) continue;
    if(Math.abs(q.y-z.y)>2.0) continue;
    const d=Math.hypot(q.x-z.pos.x,q.z-z.pos.z);
    if(d<best) best=d;
  }
  return best;
}
api.zombieAnim=function(z,dt){
  const an=z.an;
  const sp=Math.hypot(z.pos.x-an.lx,z.pos.z-an.lz)/Math.max(dt,0.001);
  an.lx=z.pos.x; an.lz=z.pos.z;
  if(sp<8) an.v+=(sp-an.v)*Math.min(1,dt*5);
  if(an.biteT>0) an.biteT-=dt;
  const near=Math.abs(z.y-player.pos.y)<2.4&&Math.hypot(z.pos.x-player.pos.x,z.pos.z-player.pos.z)<34;
  if(!near) return;                         // 見えない階の個体は動かさない
  if(an.A.bite&&z.state==="chase"&&zNearPlayer(z)<1.35) an.biteT=1.1;
  let want="walk", rate=1;
  if(an.biteT>0){ want="bite"; rate=1.5; }
  else if(an.v<0.10){ want="idle"; }
  else if(z.kind==="alert"&&z.state==="chase"&&an.A.run){
    want="run"; rate=Math.max(0.72,Math.min(1.15,an.v/RUN_V*1.25));
  }else{
    rate=Math.max(1.0,Math.min(2.6,an.v/WALK_V*0.72));
  }
  zPlay(z,want,an.first?0:(want==="bite"?0.15:0.3)); an.first=false;
  an.mixer.update(dt*rate);
};

/* ---------- 倒れた個体：倒れ込みを見せてから片付ける ---------- */
const corpses=[]; let poolGeo=null, poolMat=null;
const CORPSE_MAX=14, CORPSE_T=9.0;
function initPools(){
  const t=new THREE.CanvasTexture(cv(128,(g,s)=>{
    const gr=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    gr.addColorStop(0,"rgba(255,255,255,1)"); gr.addColorStop(0.72,"rgba(255,255,255,.92)");
    gr.addColorStop(1,"rgba(255,255,255,0)");
    g.fillStyle=gr;
    g.beginPath();
    for(let i=0;i<=40;i++){
      const a=i/40*Math.PI*2, r=s*0.5*(0.74+0.2*Math.sin(a*3+1)+0.06*Math.sin(a*7));
      const x=s/2+Math.cos(a)*r, y=s/2+Math.sin(a)*r;
      if(i) g.lineTo(x,y); else g.moveTo(x,y);
    }
    g.closePath(); g.fill();
  }));
  poolGeo=new THREE.PlaneGeometry(1,1); poolGeo.rotateX(-Math.PI/2);
  poolMat=new THREE.MeshBasicMaterial({map:t,color:0x000000,transparent:true,opacity:0.86,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
}
function dropCorpse(c){
  if(c.z.g&&c.z.g.parent) scene.remove(c.z.g);
  if(c.pool&&c.pool.parent) scene.remove(c.pool);
}
api.zombieDie=function(z){
  if(!z||!z.an||!z.an.A.death||z.boss) return false;
  z.dead=true;
  const i=zombies.indexOf(z); if(i>=0) zombies.splice(i,1);
  z.g.rotation.z=0;
  zPlay(z,"death",0.12);
  let pool=null;
  if(Q.fx>=1||corpses.length<6){
    pool=new THREE.Mesh(poolGeo,poolMat);
    pool.position.set(z.pos.x-Math.sin(z.dir)*0.95,z.y+0.012,z.pos.z-Math.cos(z.dir)*0.95);
    pool.rotation.y=Math.random()*6.3; pool.scale.setScalar(0.01);
    pool.renderOrder=2; pool.userData._sh=1; scene.add(pool);
  }
  corpses.push({z:z,t:0,pool:pool,size:0.9+Math.random()*0.5});
  while(corpses.length>CORPSE_MAX) dropCorpse(corpses.shift());
  return true;
};
function updateCorpses(dt){
  if(poolMat){
    const flOn=window.flashlight&&window.flashlight.intensity>0;
    const k=Math.min(1,0.05+AMB.intensity*0.85+(flOn?0.3:0));
    poolMat.color.setRGB(0.20*k,0.008*k,0.008*k);
  }
  for(let i=corpses.length-1;i>=0;i--){
    const c=corpses[i]; c.t+=dt;
    if(c.t<3.3) c.z.an.mixer.update(dt);
    if(c.pool){
      const g=Math.max(0,Math.min(1,(c.t-1.6)/3.5));
      c.pool.scale.setScalar(0.01+c.size*(1-(1-g)*(1-g)));
    }
    if(c.t>CORPSE_T){                       // 床に沈めて消す
      c.z.g.position.y-=dt*0.35;
      if(c.pool) c.pool.material=poolMat, c.pool.scale.multiplyScalar(Math.max(0,1-dt*1.2));
      if(c.t>CORPSE_T+1.6){ dropCorpse(c); corpses.splice(i,1); }
    }
  }
}

/* ============================================================
   画面表示（ヒットマーカー・キルログ・被弾方向・一時停止・設定）
   ============================================================ */
const el={};
const stats={shots:0,hits:0,heads:0,kills:0,deaths:0,by:{}};
function mk(tag,id,html,parent){
  const e=document.createElement(tag); if(id) e.id=id; if(html) e.innerHTML=html;
  (parent||document.body).appendChild(e); return e;
}
function settingsHtml(){
  return '<div class="optrow"><label>マウス感度</label><input type="range" data-k="sens" min="20" max="240"><output></output></div>'+
    '<div class="optrow"><label>効果音の音量</label><input type="range" data-k="vol" min="0" max="100"><output></output></div>'+
    '<div class="optrow"><label>視野角</label><input type="range" data-k="fov" min="60" max="100"><output></output></div>'+
    '<div class="optrow"><label>画質</label><div class="seg" data-k="quality">'+
    '<button data-v="low">低</button><button data-v="mid">中</button><button data-v="high">高</button></div></div>'+
    '<div class="optnote"></div>';
}
function bindSettings(root){
  const note=root.querySelector(".optnote");
  const refresh=()=>{
    for(const r of root.querySelectorAll("input[type=range]")){
      const k=r.getAttribute("data-k"); r.value=S[k];
      r.nextElementSibling.textContent=(k==="fov")?S[k]+"°":S[k];
    }
    for(const b of root.querySelectorAll(".seg button"))
      b.className=(b.getAttribute("data-v")===S.quality)?"on":"";
  };
  for(const r of root.querySelectorAll("input[type=range]"))
    r.addEventListener("input",()=>{
      const k=r.getAttribute("data-k"); S[k]=+r.value; save(); applySettings(); refreshAll();
    });
  for(const b of root.querySelectorAll(".seg button"))
    b.addEventListener("click",(e)=>{
      e.stopPropagation();
      const v=b.getAttribute("data-v"); if(v===S.quality) return;
      S.quality=v; save(); refreshAll();
      if(!started){ location.reload(); return; }
      note.textContent="画質の変更は、次に読み込んだときから反映されます。";
    });
  root._refresh=refresh; refresh();
}
const panels=[];
function refreshAll(){ for(const p of panels) p._refresh(); }
function applySettings(){
  sens=S.sens/1000*0.018;
  const sr=document.getElementById("sensrange"); if(sr) sr.value=S.sens;
  if(typeof masterGain!=="undefined"&&masterGain) masterGain.gain.value=S.vol/100;
  if(camera.fov!==S.fov){ camera.fov=S.fov; camera.updateProjectionMatrix(); api.resize(); }
}
function initHud(){
  const ui=document.getElementById("ui");
  el.hitm=mk("div","hitm","<i></i><i></i><i></i><i></i>",ui);
  el.feed=mk("div","feed","",ui);
  el.dir=mk("div","dmgdir","<i></i>",ui);
  el.kill=mk("div","killmsg","",ui);

  el.pause=mk("div","pause",
    '<div class="card"><h2>PAUSED</h2><div class="pnote">対戦は止まりません</div>'+
    '<div class="optbox">'+settingsHtml()+'</div>'+
    '<div class="sect"><div class="row"><button id="resumebtn">ゲームに戻る</button></div></div></div>');
  el.pause.className="veil";
  bindSettings(el.pause); panels.push(el.pause);
  document.getElementById("resumebtn").addEventListener("click",(e)=>{
    e.stopPropagation(); renderer.domElement.requestPointerLock();
  });

  el.opt=mk("div","optveil",
    '<div class="card"><h2>SETTINGS</h2><div class="optbox">'+settingsHtml()+'</div>'+
    '<div class="sect"><div class="row"><button id="optclose">閉じる</button></div></div></div>');
  el.opt.className="veil";
  bindSettings(el.opt); panels.push(el.opt);
  document.getElementById("optclose").addEventListener("click",()=>{ el.opt.style.display="none"; });
  const ob=document.getElementById("optbtn");
  if(ob) ob.addEventListener("click",()=>{ refreshAll(); el.opt.style.display="flex"; });
}
function flashEl(e,cls,ms){
  e.className=cls; void e.offsetWidth; e.classList.add("show");
  clearTimeout(e._t); e._t=setTimeout(()=>{ e.classList.remove("show"); },ms);
}
function feed(html){
  const d=document.createElement("div"); d.className="fe"; d.innerHTML=html;
  el.feed.appendChild(d);
  while(el.feed.children.length>5) el.feed.removeChild(el.feed.firstChild);
  setTimeout(()=>{ d.classList.add("out"); setTimeout(()=>{ if(d.parentNode) d.parentNode.removeChild(d); },500); },5200);
}
const nm=(s)=>'<b style="color:'+SLOT_CSS[s]+'">'+SLOT_NAME[s]+'</b>';

/* ============================================================
   ゲーム側から呼ばれるフック
   ============================================================ */
api.ready=function(){
  dotTex=softDot();
  sparks=new PS(Math.round(260*Q.fx),true);
  smoke=new PS(Math.round(220*Q.fx),false);
  initPools(); initDecals(); initShells(); initMuzzle(); initMotes(); initLamps(); initViewModel(); initHud();
  if(Q.shadow&&window.flashlight){
    const fl=window.flashlight;
    fl.castShadow=true;
    fl.shadow.mapSize.set(1024,1024);
    fl.shadow.camera.near=0.3; fl.shadow.camera.far=30;
    fl.shadow.bias=-0.0008; fl.shadow.normalBias=0.03; fl.shadow.radius=2.2;
    sweepShadows();
  }
  api.resize();
};

api.fired=function(sg){
  stats.shots++;
  kick=1;
  if(mflash){
    mflash.visible=true; mflashSeen=false; mflashT=sg?0.065:0.05;
    mflash.rotation.z=Math.random()*6.3;
    mflash.scale.setScalar(sg?0.40:0.24);
  }
  ejectShell(sg);
  _sv.set(0.20,-0.125,-0.80); camera.localToWorld(_sv);
  _sr.set(0,0,-1).applyQuaternion(camera.quaternion);
  for(let i=0;i<Math.round((sg?5:2)*Q.fx);i++)
    smoke.emit(_sv.x,_sv.y,_sv.z,_sr.x*1.4+rnd(0.3),_sr.y*1.4+0.3+rnd(0.2),_sr.z*1.4+rnd(0.3),
      0.7,0.68,0.64,0.16, 0.06,0.5+Math.random()*0.3,-0.3,3.0,0.5);
};

let ray=null;
api.shot=function(origin,dirs,len,sg){
  if(!ray) ray=new THREE.Raycaster();
  const seen=sg?3:1;
  for(let i=0;i<dirs.length;i++){
    if(!dirs[i]) continue;
    ray.set(origin,dirs[i]); ray.near=0.15; ray.far=len+0.06;
    const h=ray.intersectObjects(losBlockers,false);
    if(!h.length||!h[0].face) continue;
    const hit=h[0];
    _dn.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    addDecal(hit);
    if(i<seen||Math.random()<0.5) impactFx(hit.point,_dn,sg?0.6:1);
    if(i===0&&typeof noiseBurst==="function"){
      const d=hit.distance;
      noiseBurst(0.05,0.10*Math.max(0.15,1-d/30),2600+Math.random()*1800);
    }
  }
};

api.hitConfirm=function(head,p,z){
  stats.hits++; if(head) stats.heads++;
  if(time-killAt>0.15) flashEl(el.hitm,head?"head":"",head?260:200);
  if(typeof tone==="function"){
    if(head){ tone("triangle",2100,1700,0.06,0.10); tone("triangle",2800,2400,0.09,0.07,0.045); }
    else tone("triangle",1320,1050,0.06,0.09);
  }
  const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw);
  if(p) bodyFx(p.x,p.y+(p.cr?0.75:1.2)+(head?0.42:0),p.z,fx,fz,false);
  else if(z&&z.pos) bodyFx(z.pos.x,(z.y||0)+(z.boss?2.6:1.15),z.pos.z,fx,fz,!!z.boss);
};

api.remoteFire=function(slot,w){
  const p=P[slot]; if(!p||!p.av||!p.av.flash) return;
  p.av.flash.getWorldPosition(_sv);
  for(let i=0;i<Math.round(5*Q.fx);i++)
    sparks.emit(_sv.x,_sv.y,_sv.z,rnd(1.6),rnd(1.6),rnd(1.6),
      hdr?5:1,hdr?3.4:0.8,hdr?1.4:0.4,1, w?0.12:0.08, 0.05+Math.random()*0.04, 0,0,0);
  smoke.emit(_sv.x,_sv.y,_sv.z,rnd(0.3),0.3,rnd(0.3),0.7,0.68,0.64,0.16,0.07,0.6,-0.3,3,0.5);
};

/* ライフが減ったとき（全員に届く）。倒した相手・倒された方向・キルログを出す */
api.life=function(m){
  const me=net.mySlot, v=m.slot, by=m.by;
  const zone=(by==null||by===v);
  const pos=(v===me)?player.pos:P[v];
  if(pos) bodyFx(pos.x,pos.y+1.15,pos.z,0,0,true);
  if(zone) feed(nm(v)+' <span>閉鎖に巻き込まれた</span>'+(m.alive?"":' <em>脱落</em>'));
  else{
    feed(nm(by)+' <span>▸</span> '+nm(v)+(m.alive?"":' <em>脱落</em>'));
    stats.by[by]=(stats.by[by]||0)+1;
  }
  if(v===me){
    stats.deaths++;
    if(!zone&&P[by]){
      const s=(typeof posOf==="function")?posOf(by):P[by];
      const dx=s.x-player.pos.x, dz=s.z-player.pos.z;
      const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw);
      const rx=Math.cos(player.yaw), rz=-Math.sin(player.yaw);
      const ang=Math.atan2(dx*rx+dz*rz,dx*fx+dz*fz);
      el.dir.style.transform="rotate("+ang+"rad)";
      flashEl(el.dir,"",1400);
    }
  }else if(by===me&&!zone){
    stats.kills++;
    el.kill.innerHTML=(m.alive?"DOWN ":"ELIMINATED ")+nm(v);
    flashEl(el.kill,m.alive?"":"out",m.alive?1300:2200);
    flashEl(el.hitm,"kill",420); killAt=time;
    if(typeof tone==="function"){
      tone("sine",880,880,0.10,0.10,0.03); tone("sine",1320,1320,0.16,0.10,0.11);
      if(!m.alive) tone("sine",1760,1760,0.26,0.10,0.22);
    }
  }
};
api.teamDown=function(m){
  feed(nm(m.slot)+' <em>ダウン</em>');
  if(m.slot===net.mySlot) stats.deaths++;
  const pos=(m.slot===net.mySlot)?player.pos:P[m.slot];
  if(pos) bodyFx(pos.x,pos.y+1.15,pos.z,0,0,true);
};
api.zombieDown=function(z,by,boss){
  if(z&&z.pos){
    bodyFx(z.pos.x,(z.y||0)+(boss?2.6:1.1),z.pos.z,0,0,true);
    if(boss) for(let i=0;i<4;i++) bodyFx(z.pos.x+rnd(1),(z.y||0)+1+Math.random()*3,z.pos.z+rnd(1),0,0,true);
  }
  if(by===net.mySlot){
    stats.kills++;
    flashEl(el.hitm,"kill",320);
  }
  if(boss&&by!=null&&P[by]) feed(nm(by)+' <span>▸</span> <em>BOSS</em>');
};
api.hurt=function(){ hurtT=1; };

api.result=function(){
  const w=document.getElementById("winstats"); if(!w) return;
  const acc=stats.shots?Math.round(stats.hits/stats.shots*100):0;
  let h='<div class="st"><div><b>'+stats.shots+'</b>発射</div><div><b>'+acc+'%</b>命中率</div>'+
        '<div><b>'+stats.heads+'</b>ヘッドショット</div><div><b>'+stats.kills+'</b>'+(mode==="team"?"討伐":"撃破")+'</div>'+
        '<div><b>'+stats.deaths+'</b>被弾</div></div>';
  if(mode!=="team"){
    const rows=[];
    for(let i=0;i<MAXP;i++) if(P[i].used) rows.push({s:i,k:stats.by[i]||0});
    rows.sort((a,b)=>b.k-a.k);
    h+='<div class="rk">';
    for(const r of rows) h+='<div>'+nm(r.s)+(r.s===net.mySlot?"（あなた）":"")+'<span>撃破 '+r.k+'</span></div>';
    h+='</div>';
  }
  w.innerHTML=h;
};

/* ============================================================
   毎フレーム
   ============================================================ */
let fAcc=0, fN=0, fCool=4;
var killAt=-9;
api.frame=function(dt){
  time+=dt;
  /* 一時停止パネル */
  if(el.pause){
    const show=started&&!finished&&document.pointerLockElement!==renderer.domElement;
    if(show!==el.pause._on){
      el.pause._on=show; el.pause.style.display=show?"flex":"none";
      if(show) refreshAll();
    }
  }
  if(typeof masterGain!=="undefined"&&masterGain&&Math.abs(masterGain.gain.value-S.vol/100)>0.001)
    masterGain.gain.value=S.vol/100;

  updateViewModel(dt);
  updateLamps(dt);
  /* 非常灯はピクセル単位の照明だと強く出すぎるので、そのぶん絞る */
  if(Q.lit&&started&&!finished){
    const ek=flags.lightsOn?0.40:0.48;
    for(let i=0;i<emergLights.length;i++) emergLights[i].intensity*=ek;
  }
  updateShells(dt);
  updateCorpses(dt);
  if(mflash&&mflash.visible){          // 低いフレームレートでも最低1コマは見せる
    if(mflashSeen&&mflashT<=0) mflash.visible=false;
    mflashT-=dt; mflashSeen=true;
  }

  /* 煙は周囲の明るさに合わせる（暗闇で光って見えないように） */
  const flOn=window.flashlight&&window.flashlight.intensity>0;
  if(smoke) smoke.mat.uniforms.lit.value=Math.min(1,0.06+AMB.intensity*0.9+(flOn?0.45:0)+(muzzleT>0?0.5:0));
  for(const ps of systems) ps.update(dt);
  if(motes){
    const u=motes.material.uniforms;
    u.t.value=time; u.cam.value.copy(camera.position);
    camera.getWorldDirection(u.dir.value);
    u.power.value+=(((flOn&&started)?0.55:0)-u.power.value)*Math.min(1,dt*5);
    motes.visible=u.power.value>0.01;
  }
  if(Q.shadow){ shT-=dt; if(shT<=0){ shT=1.5; sweepShadows(); } }

  /* 残りライフ1のとき、画面の縁を脈打たせる */
  if(el.hitm){
    const low=started&&!finished&&alive&&mode!=="team"&&LIVES>1&&lives===1;
    if(low!==el._low){ el._low=low; document.body.classList.toggle("lowlife",low); }
  }

  if(hurtT>0) hurtT=Math.max(0,hurtT-dt*1.8);
  if(composer){
    const u=finalPass.material.uniforms;
    u.time.value=time; u.hurt.value=hurtT;
    composer.render(dt);
  }else{
    renderer.render(scene,camera);
  }

  /* 重い端末では解像度を自動で落とす */
  if(started&&!finished&&document.hasFocus()){
    if(fCool>0) fCool-=dt;
    else{
      fAcc+=dt; fN++;
      if(fN>=90){
        const avg=fAcc/fN; fAcc=0; fN=0;
        if(avg>1/36&&resScale>0.55){ resScale=Math.max(0.55,resScale-0.15); api.resize(); fCool=3; }
      }
    }
  }
};

api.settings=S; api.quality=Q; api.stats=stats; api._zPlay=zPlay;
return api;
})();
