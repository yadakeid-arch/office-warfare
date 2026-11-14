"use strict";

/* ---- 描画強化レイヤー（fx.js）が参照する名前を、このゲームの状態に結び付ける ---- */
const FLOORS=3, MAXP=0, P=[], net={mySlot:0,on:false};
Object.defineProperty(window,"finished",{get(){ return dead||cleared; }});
Object.defineProperty(window,"alive",{get(){ return !dead; }});
window.lives=0; window.LIVES=0;      // 残り体力の警告はこのゲーム自身が出す
/* ============================================================
   NIGHT SHIFT — 3階建てオフィス 一人称探索ホラー (Three.js r128)
   フロア構成 : 1F y=0 / 2F y=4 / 3F y=8
   建物本体   : x -14..14 , z -9..9
   非常階段   : x -22..-14 , z -3..3 (折返し階段)
   エレベータ : x  14..20  , z -3..3 (シャフト貫通)
   ============================================================ */

/* ---------- 定数 ---------- */
const T=0.24, CEIL=3.2, FH=4, EYE=1.62;
const WALK=3.1, RUN=5.0, PLAYER_R=0.30;
const FLOOR_NAME=["1F","2F","3F","RF"];
const ROOF_Y=12;   // 屋上（非常階段からのみ到達）
const BASE_Y=-4, CEIL_B=2.6;   // 地下室（1Fの梯子からのみ到達）
function inBasement(x,z){
  if(x>=-1.45&&x<=1.45&&z>=-14.2&&z<=8.1) return true;   // 細長い廊下＋梯子の足元
  if(x>=-4.25&&x<=4.25&&z>=-20.2&&z<=-14)  return true;   // 突き当りの小部屋
  return false;
}

/* ---------- グローバル ---------- */
let scene,camera,renderer,clock,AMB,HEM,viewGun,muzzle,roofLight,skyGroup,baseFog=0.057;
const colliders=[];      // {box:Box3, active:bool, key:string}
const losBlockers=[];    // 視線を遮るメッシュ
const interacts=[];      // 調べられるもの
const zombies=[];
const doors=[];
const tickers=[];        // 毎フレーム呼ぶ関数

let started=false, dead=false, cleared=false, elapsed=0;
let sens=0.0018;

const player={
  pos:new THREE.Vector3(11,8,0), vy:0, yaw:-Math.PI/2, pitch:0,   // エレベーター側を向いて開始
  stam:100, riding:false, bob:0
};
const keysHeld={};
const inventory={};      // id -> 表示名
const invColor={};       // id -> 色(css)
const KEYCOL={ k3a:0x3f7fd0, k3d:0x46a05a, kstair:0xc2402f, k2a:0xd8a520, k2b:0x9a63c8, kroof:0x7fd8e8, kbase:0xe07b3c };
function cssHex(c){ return "#"+("000000"+c.toString(16)).slice(-6); }
function dimCol(c,f){
  const r=Math.min(255,((c>>16)&255)*f)|0, g=Math.min(255,((c>>8)&255)*f)|0, b=Math.min(255,(c&255)*f)|0;
  return (r<<16)|(g<<8)|b;
}
const flags={power:false,power3f:false,called:false,roofReady:false,roofArrived:false,magTaken:false,reinforced:false,downHinted:false,phoneHinted:false};
// 天井の照明が点いているか（建物の電源が入っていて、3Fの暗闇の中でもない）
Object.defineProperty(flags,"lightsOn",{get(){ return flags.power&&!is3FDark(); }});
let flashOn=true, flashTarget=null, nearLight=null, bgmStarted=false, wasInLadderRoom=false, wasNearNote=false;
const emergFloor=[];
// 3Fは会議室のブレーカーを入れるまで完全な暗闇（非常階段側は対象外）
function is3FDark(){ return !flags.power3f && Math.abs(player.pos.y-8)<1.4 && player.pos.x>-14.0; }
function inBasementNow(){ return player.pos.y<-2; }
// 完全な暗闇（懐中電灯は足元だけ）＝ 3Fのブレーカー前と地下室
function isPitchDark(){ return is3FDark()||inBasementNow(); }
function lightsOffHere(){
  if(player.pos.y<-2) return true;                                             // 地下は常に薄暗い
  if(Math.abs(player.pos.y-8)<1.4 && player.pos.x>-14.0) return !flags.power3f;
  return !flags.power;
}
const DIFF={
  easy  :{hp:5, ammo:15, infinite:true,  lightsOn:true,  startGun:true },
  normal:{hp:3, ammo:15, infinite:false, lightsOn:false, startGun:false},
  hard  :{hp:2, ammo:10, infinite:false, lightsOn:false, startGun:false}
};
let mode="normal", DF=DIFF.normal;
let HP_MAX=3, AMMO_MAX=15;
const HELI={ R:6.2, H:20.5, SPD:0.26, LADDER:6.7 };   // 旋回半径・高度・角速度・はしごの長さ
let heliGroup=null, heliRotor=null, heliTail=null, heliLadder=null, heliAng=0;
let survivor=null, survArms=null, survLegs=null, survHead=null, survT=0;
const heliPos=new THREE.Vector3();
const ending={active:false,phase:"",t:0,vy:0,fx:0,fy:0,fz:0};
let choiceOpen=false, phoneMesh=null, rescueGroup=null, roofNote=null, ladderNear=false;
let gunPickup=null, gunPickupMesh=null;
const flashers=[];
let script=[], scriptT=0;
function runScript(list){ script=list.slice(); scriptT=0; }
let hp=3, invuln=0, shake=0;
let ammo=0, hasGun=false, muzzleT=0, recoil=0;

/* ============================================================
   テクスチャ生成（外部素材なし・すべてCanvas）
   ============================================================ */
function makeTex(draw,rx,ry,size){
  size=size||128;
  const c=document.createElement("canvas"); c.width=c.height=size;
  const g=c.getContext("2d"); draw(g,size);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rx||1,ry||1);
  t.encoding=THREE.sRGBEncoding; t.anisotropy=4;
  return t;
}
function noise(g,s,base,amt){
  g.fillStyle=base; g.fillRect(0,0,s,s);
  const img=g.getImageData(0,0,s,s), d=img.data;
  for(let i=0;i<d.length;i+=4){
    const n=(Math.random()-0.5)*amt;
    d[i]+=n; d[i+1]+=n; d[i+2]+=n;
  }
  g.putImageData(img,0,0);
}
const TEX={};
function initTex(){
  TEX.wall=makeTex((g,s)=>{
    noise(g,s,"#8d8a82",26);
    g.globalAlpha=.10; g.fillStyle="#4a463f";
    for(let i=0;i<40;i++){const x=Math.random()*s;g.fillRect(x,0,1+Math.random()*2,s);}
    g.globalAlpha=1;
  },4,1);
  TEX.carpet=makeTex((g,s)=>{
    noise(g,s,"#3b3a3f",34);
    g.globalAlpha=.16; g.fillStyle="#22222a";
    for(let i=0;i<s;i+=4) g.fillRect(0,i,s,2);
    g.globalAlpha=1;
  },14,9);
  TEX.ceil=makeTex((g,s)=>{
    noise(g,s,"#b9b6ad",14);
    g.strokeStyle="rgba(60,58,54,.55)"; g.lineWidth=3;
    g.strokeRect(0,0,s,s);
  },14,9);
  TEX.concrete=makeTex((g,s)=>{
    noise(g,s,"#6e6e6b",30);
    g.globalAlpha=.12;g.fillStyle="#3a3a38";
    for(let i=0;i<14;i++){g.fillRect(Math.random()*s,Math.random()*s,Math.random()*22,2);}
    g.globalAlpha=1;
  },3,2);
  TEX.metal=makeTex((g,s)=>{
    noise(g,s,"#7a7f85",16);
    g.globalAlpha=.2;g.fillStyle="#5b6066";
    for(let i=0;i<s;i+=6) g.fillRect(i,0,2,s);
    g.globalAlpha=1;
  },1,1);
  TEX.wood=makeTex((g,s)=>{
    noise(g,s,"#6b5136",22);
    g.globalAlpha=.18;g.fillStyle="#4a361f";
    for(let i=0;i<10;i++) g.fillRect(0,Math.random()*s,s,1+Math.random()*3);
    g.globalAlpha=1;
  },1,1);
  TEX.asphalt=makeTex((g,s)=>{noise(g,s,"#232629",22);},30,30);
}
function label(text,bg,fg,w,h){
  w=w||256;h=h||128;
  const c=document.createElement("canvas");c.width=w;c.height=h;
  const g=c.getContext("2d");
  g.fillStyle=bg||"#d8d4c8";g.fillRect(0,0,w,h);
  g.fillStyle=fg||"#20222a";
  g.font="bold "+Math.floor(h*0.5)+"px sans-serif";
  g.textAlign="center";g.textBaseline="middle";
  g.fillText(text,w/2,h/2+2);
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
}

/* ============================================================
   マテリアル
   ============================================================ */
let MAT={};
function initMat(){
  MAT.wall     =new THREE.MeshLambertMaterial({map:TEX.wall,color:0x8c8a83});
  MAT.wallDark =new THREE.MeshLambertMaterial({map:TEX.wall,color:0x6a6862});
  MAT.floor    =new THREE.MeshLambertMaterial({map:TEX.carpet});
  MAT.ceil     =new THREE.MeshLambertMaterial({map:TEX.ceil,color:0x817f7a});
  MAT.concrete =new THREE.MeshLambertMaterial({map:TEX.concrete});
  MAT.metal    =new THREE.MeshLambertMaterial({map:TEX.metal,color:0x9aa1a8});
  MAT.wood     =new THREE.MeshLambertMaterial({map:TEX.wood});
  MAT.door     =new THREE.MeshLambertMaterial({color:0x9c9186});
  MAT.doorLock =new THREE.MeshLambertMaterial({color:0x7e6f63});
  MAT.glass    =new THREE.MeshLambertMaterial({color:0x9fd0d8,transparent:true,opacity:0.24});
  MAT.dark     =new THREE.MeshLambertMaterial({color:0x2a2c31});
  MAT.zombie   =new THREE.MeshLambertMaterial({color:0x556052});
  MAT.zombieSkin=new THREE.MeshLambertMaterial({color:0x93998a});
  MAT.eye      =new THREE.MeshBasicMaterial({color:0xff4530});
  MAT.emerg    =new THREE.MeshBasicMaterial({color:0xff3b2a});
  MAT.lampOff  =new THREE.MeshBasicMaterial({color:0x2e3238});
  MAT.lampOn   =new THREE.MeshBasicMaterial({color:0xe9e6d6});
  MAT.gold     =new THREE.MeshLambertMaterial({color:0xf0cf6a,emissive:0x8f6f18});
  MAT.gunmetal =new THREE.MeshLambertMaterial({color:0x4a4f56,emissive:0x14161a});
  MAT.gunslide =new THREE.MeshLambertMaterial({color:0x6d747c,emissive:0x1a1d21});
  MAT.gungrip  =new THREE.MeshLambertMaterial({color:0x2e2a26,emissive:0x0d0c0b});
  MAT.ammoBox  =new THREE.MeshLambertMaterial({color:0x8a6b3a,emissive:0x2b2011});
  MAT.asphalt  =new THREE.MeshLambertMaterial({map:TEX.asphalt,color:0x555a5e});
  MAT.roof     =new THREE.MeshLambertMaterial({map:TEX.concrete,color:0x6a6d70});
  MAT.roofWall =new THREE.MeshLambertMaterial({map:TEX.concrete,color:0x5c5f62});
  MAT.phoneBody=new THREE.MeshLambertMaterial({color:0x2f6f4f,emissive:0x0d2418});
  MAT.cushion  =new THREE.MeshLambertMaterial({color:0x2f6fd0,emissive:0x14335f});
  MAT.heliBody =new THREE.MeshLambertMaterial({color:0x2b3a4a,emissive:0x0c1218});
  MAT.heliGlass=new THREE.MeshLambertMaterial({color:0x8fb8d8,transparent:true,opacity:0.42});
  MAT.rotor    =new THREE.MeshLambertMaterial({color:0x1b2027});
  MAT.rope     =new THREE.MeshLambertMaterial({color:0x6b5a3e});
  MAT.survCloth=new THREE.MeshLambertMaterial({color:0x3f5f86});
  MAT.survPants=new THREE.MeshLambertMaterial({color:0x2e3540});
  MAT.survSkin =new THREE.MeshLambertMaterial({color:0xd7ac86});
  MAT.survHair =new THREE.MeshLambertMaterial({color:0x22201e});
}

/* ============================================================
   基本ジオメトリヘルパ
   ============================================================ */
function blocker(w,h,d,x,y,z){
  colliders.push({
    box:new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x,y,z),new THREE.Vector3(w,h,d)),
    active:true, tag:"fill"});
}
function box(w,h,d,x,y,z,mat,opt){
  opt=opt||{};
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(x,y,z);
  scene.add(m);
  if(opt.collide!==false){
    colliders.push({
      box:new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x,y,z),new THREE.Vector3(w,h,d)),
      active:true, tag:opt.tag||""
    });
  }
  if(opt.los!==false) losBlockers.push(m);
  return m;
}
// z一定・x方向に伸びる壁（gaps=[[x1,x2],...] は開口）
function wallX(z,x1,x2,y,mat,gaps,h){
  h=h||CEIL; gaps=gaps||[];
  let segs=[[x1,x2]];
  for(const g of gaps){
    const ns=[];
    for(const s of segs){
      if(g[1]<=s[0]||g[0]>=s[1]){ns.push(s);continue;}
      if(s[0]<g[0])ns.push([s[0],g[0]]);
      if(g[1]<s[1])ns.push([g[1],s[1]]);
    }
    segs=ns;
  }
  for(const s of segs){ if(s[1]-s[0]<0.02)continue; box(s[1]-s[0],h,T,(s[0]+s[1])/2,y+h/2,z,mat); }
  for(const g of gaps){ const dh=2.2; if(h>dh) box(g[1]-g[0],h-dh,T,(g[0]+g[1])/2,y+dh+(h-dh)/2,z,mat); }
}
// x一定・z方向に伸びる壁
function wallZ(x,z1,z2,y,mat,gaps,h){
  h=h||CEIL; gaps=gaps||[];
  let segs=[[z1,z2]];
  for(const g of gaps){
    const ns=[];
    for(const s of segs){
      if(g[1]<=s[0]||g[0]>=s[1]){ns.push(s);continue;}
      if(s[0]<g[0])ns.push([s[0],g[0]]);
      if(g[1]<s[1])ns.push([g[1],s[1]]);
    }
    segs=ns;
  }
  for(const s of segs){ if(s[1]-s[0]<0.02)continue; box(T,h,s[1]-s[0],x,y+h/2,(s[0]+s[1])/2,mat); }
  for(const g of gaps){ const dh=2.2; if(h>dh) box(T,h-dh,g[1]-g[0],x,y+dh+(h-dh)/2,(g[0]+g[1])/2,mat); }
}

/* ============================================================
   ドア
   ============================================================ */
function makeDoor(o){
  // o:{x,y,z,axis:'x'|'z',width,hingeSign,locked,keyId,name,sign}
  const w=o.width||1.5, h=2.15;
  const pivot=new THREE.Group();
  pivot.position.set(o.x,o.y,o.z);
  if(o.axis==="x"){ // 開口はx方向 → ドア板もx方向
    pivot.position.x = o.x - o.hingeSign*w/2;
  }else{
    pivot.position.z = o.z - o.hingeSign*w/2;
  }
  scene.add(pivot);
  const dmat = o.color!=null
    ? new THREE.MeshLambertMaterial({color:o.color,emissive:dimCol(o.color,0.14)})
    : (o.locked?MAT.doorLock:MAT.door);
  const panel=new THREE.Mesh(new THREE.BoxGeometry(o.axis==="x"?w:0.09,h,o.axis==="x"?0.09:w),dmat);
  if(o.axis==="x") panel.position.set(o.hingeSign*w/2,h/2,0);
  else panel.position.set(0,h/2,o.hingeSign*w/2);
  pivot.add(panel);
  // ノブ
  const knob=new THREE.Mesh(new THREE.SphereGeometry(0.055,8,8),MAT.metal);
  if(o.axis==="x") knob.position.set(o.hingeSign*(w-0.18),1.02,0.09);
  else knob.position.set(0.09,1.02,o.hingeSign*(w-0.18));
  pivot.add(knob);
  losBlockers.push(panel);

  // 当たり判定（閉時）
  const col={
    box:new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(o.x,o.y+h/2,o.z),
      new THREE.Vector3(o.axis==="x"?w:0.3,h,o.axis==="x"?0.3:w)),
    active:true,tag:"door"};
  colliders.push(col);

  // ドアプレート
  if(o.sign){
    const pl=new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.26),
      new THREE.MeshBasicMaterial({map:label(o.sign,o.color!=null?cssHex(o.color):"#cfcabc","#0f1115",256,128)}));
    if(o.axis==="x"){ pl.position.set(o.x+ (o.hingeSign>0?-w/2-0.55:w/2+0.55),o.y+1.85,o.z+(o.faceSign||1)*0.14);
      if((o.faceSign||1)<0) pl.rotation.y=Math.PI; }
    else { pl.position.set(o.x+(o.faceSign||1)*0.14,o.y+1.85,o.z+(o.hingeSign>0?-w/2-0.55:w/2+0.55));
      pl.rotation.y=(o.faceSign||1)>0?Math.PI/2:-Math.PI/2; }
    scene.add(pl);
  }

  const d={pivot,panel,col,open:false,t:0,locked:!!o.locked,keyId:o.keyId,name:o.name||"ドア",
           axis:o.axis,hingeSign:o.hingeSign,pos:new THREE.Vector3(o.x,o.y+1,o.z)};
  doors.push(d);

  interacts.push({
    pos:d.pos, r:2.4,
    label:()=>{
      if(d.open) return null;
      if(d.locked) return inventory[d.keyId] ? d.name+"を解錠する" : d.name+"（施錠されている）";
      return d.name+"を開ける";
    },
    use:()=>{
      if(d.open)return;
      if(d.locked){
        if(!inventory[d.keyId]){ say("鍵がかかっている。\nどこかに鍵があるはずだ。"); sfx("locked"); return; }
        d.locked=false; sfx("unlock");
        say(inventory[d.keyId]+"で"+d.name+"を解錠した。");
      }
      d.open=true; d.col.active=false; sfx("door");
      if(d.keyId==="kroof"&&roofNote){ scene.remove(roofNote); roofNote=null; }
      onDoorOpened(d);
    }
  });
  return d;
}
function updateDoors(dt){
  for(const d of doors){
    const tgt=d.open?1:0;
    if(Math.abs(d.t-tgt)>0.001){
      d.t+=(tgt-d.t)*Math.min(1,dt*3.2);
      const a=d.t*Math.PI*0.52*(d.hingeSign);
      d.pivot.rotation.y = d.axis==="x" ? a : -a;
    }
  }
}

/* ============================================================
   アイテム（鍵）
   ============================================================ */
function freeSpot(x,z,y,r){
  r=r||0.45;
  if(!blocked(x,z,r,y)) return [x,z];
  for(let rad=0.45;rad<4.5;rad+=0.45){
    for(let a=0;a<20;a++){
      const ang=a/20*Math.PI*2;
      const nx=x+Math.cos(ang)*rad, nz=z+Math.sin(ang)*rad;
      if(!blocked(nx,nz,r,y)) return [nx,nz];
    }
  }
  return [x,z];
}
function makePickup(o){
  // o:{mesh(Group), x,y,z, label, onTake, float}
  const sp=freeSpot(o.x,o.z,o.y); const x=sp[0], z=sp[1];
  const g=o.mesh; g.position.set(x,o.y+(o.lift||0.35),z); scene.add(g);
  tickers.push(dt=>{ if(!g.parent||!g.visible)return; g.rotation.y+=dt*0.8;
    g.position.y=o.y+(o.lift||0.35)+Math.sin(performance.now()*0.0022)*0.04; });
  const it={
    pos:new THREE.Vector3(x,o.y+0.6,z), r:2.1, hidden:false,
    label:function(){ return this.hidden?null:o.label; },
    use:()=>{
      scene.remove(g);
      const i=interacts.indexOf(it); if(i>=0)interacts.splice(i,1);
      o.onTake();
    }
  };
  interacts.push(it);
  return it;
}
const GUNMODEL={ ready:false, scene:null, base:1, grip:null };
const gunVisuals=[];
// 実測: モデルはY-up・銃口+Z。カメラは-Zを向くのでY軸180度回す
const GUN_LEN=0.35;                                   // 全長(m)
const GUN_GRIP=new THREE.Vector3(0,-0.024,-0.335);    // bbox中心からグリップまで(全長比)
function loadGunModel(){
  const buf=window.ASSETS&&ASSETS.pistol;
  if(!buf||!THREE.GLTFLoader) return;
  new THREE.GLTFLoader().parse(buf,"",(gltf)=>{
    const root=gltf.scene;
    root.traverse(o=>{ if(o.isMesh){
      o.material=Array.isArray(o.material)?o.material.map(toLambert):toLambert(o.material);
      o.frustumCulled=false;
    }});
    root.updateMatrixWorld(true);
    const b=new THREE.Box3().setFromObject(root);
    const size=new THREE.Vector3().subVectors(b.max,b.min);
    const maxd=Math.max(size.x,size.y,size.z)||1;
    GUNMODEL.base=GUN_LEN/maxd;
    const c=new THREE.Vector3().addVectors(b.min,b.max).multiplyScalar(0.5);
    GUNMODEL.grip=new THREE.Vector3(c.x+GUN_GRIP.x*maxd,c.y+GUN_GRIP.y*maxd,c.z+GUN_GRIP.z*maxd);
    GUNMODEL.scene=root; GUNMODEL.ready=true;
    for(const g of gunVisuals) applyGunModel(g);
  },()=>{});
}
function applyGunModel(g){
  if(!GUNMODEL.ready) return;
  while(g.children.length) g.remove(g.children[0]);
  const inst=GUNMODEL.scene.clone(true);
  const s=GUNMODEL.base*(g.userData.gunScale||1);
  inst.scale.setScalar(s);
  inst.rotation.y=Math.PI;                       // 銃口をカメラ前方(-Z)へ
  inst.position.set(GUNMODEL.grip.x*s, -GUNMODEL.grip.y*s, GUNMODEL.grip.z*s);
  g.add(inst);
}
function makeGunMesh(scale){
  const g=new THREE.Group(); const s=scale||1;
  g.userData.gunScale=s;
  gunVisuals.push(g);
  const proc=makeProcGun(s); g.add(proc);
  if(GUNMODEL.ready) applyGunModel(g);
  return g;
}
function makeProcGun(s){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.09*s,0.13*s,0.30*s),MAT.gunmetal);
  body.position.set(0,0.05*s,0); g.add(body);
  const slide=new THREE.Mesh(new THREE.BoxGeometry(0.075*s,0.07*s,0.34*s),MAT.gunslide);
  slide.position.set(0,0.13*s,-0.02*s); g.add(slide);
  const grip=new THREE.Mesh(new THREE.BoxGeometry(0.08*s,0.19*s,0.11*s),MAT.gungrip);
  grip.position.set(0,-0.07*s,0.09*s); grip.rotation.x=-0.22; g.add(grip);
  const guard=new THREE.Mesh(new THREE.BoxGeometry(0.05*s,0.03*s,0.09*s),MAT.gunmetal);
  guard.position.set(0,-0.03*s,0.02*s); g.add(guard);
  return g;
}
function makeAmmoMesh(){
  const g=new THREE.Group();
  const b=new THREE.Mesh(new THREE.BoxGeometry(0.26,0.13,0.17),MAT.ammoBox); g.add(b);
  for(let i=0;i<3;i++){
    const c=new THREE.Mesh(new THREE.BoxGeometry(0.035,0.09,0.035),MAT.gold);
    c.position.set(-0.07+i*0.07,0.10,0); g.add(c);
  }
  return g;
}
function makeKey(id,name,x,y,z,objAfter,note){
  const sp=freeSpot(x,z,y); x=sp[0]; z=sp[1];
  const col=KEYCOL[id]!=null?KEYCOL[id]:0xf0cf6a;
  const km=new THREE.MeshLambertMaterial({color:col,emissive:dimCol(col,0.42)});
  const g=new THREE.Group(); g.position.set(x,y+0.42,z);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.019,6,14),km);
  ring.rotation.x=Math.PI/2; g.add(ring);
  const shaft=new THREE.Mesh(new THREE.BoxGeometry(0.028,0.028,0.24),km);
  shaft.position.z=0.15; g.add(shaft);
  const bit=new THREE.Mesh(new THREE.BoxGeometry(0.028,0.09,0.04),km);
  bit.position.set(0,-0.04,0.24); g.add(bit);
  scene.add(g);
  tickers.push(dt=>{ g.rotation.y+=dt*1.1; g.position.y=y+0.42+Math.sin(performance.now()*0.0022)*0.045; });

  const it={
    pos:new THREE.Vector3(x,y+0.6,z), r:2.0,
    label:()=> name+"を拾う",
    use:()=>{
      inventory[id]=name; invColor[id]=cssHex(col); scene.remove(g); sfx("pickup");
      const i=interacts.indexOf(it); if(i>=0)interacts.splice(i,1);
      say(name+"を手に入れた。"+(note?"\n"+note:""),note?4.0:3.4); refreshInv();
      if(objAfter) setObjective(objAfter);
    }
  };
  interacts.push(it);
}

/* ============================================================
   フロア構築
   ============================================================ */
const ROOMS={
  2:[ // 3F
    {id:"3A",name:"資料室 3A",side:"N",left:true ,locked:true ,keyId:"k3a"},
    {id:"3B",name:"会議室",   side:"N",left:false,locked:false},
    {id:"3C",name:"給湯室",   side:"S",left:true ,locked:false},
    {id:"3D",name:"備品庫 3D",side:"S",left:false,locked:true ,keyId:"k3d"}
  ],
  1:[ // 2F
    {id:"2A",name:"倉庫 2A",  side:"N",left:true ,locked:true ,keyId:"k2a"},
    {id:"2B",name:"機械室 2B",side:"N",left:false,locked:true ,keyId:"k2b"},
    {id:"2C",name:"事務室",   side:"S",left:true ,locked:false},
    {id:"2D",name:"休憩室",   side:"S",left:false,locked:false}
  ],
  0:[] // 1F はロビー
};
const emergLights=[];

function buildFloor(fi){
  const y=fi*FH;
  // 床・天井
  const fl=new THREE.Mesh(new THREE.BoxGeometry(28.4,0.6,18.4),MAT.floor);
  fl.position.set(0,y-0.3,0); scene.add(fl);
  const cl=new THREE.Mesh(new THREE.BoxGeometry(28.4,0.2,18.4),MAT.ceil);
  cl.position.set(0,y+CEIL+0.1,0); scene.add(cl);

  const eDoorGap=[[-0.9,0.9]];
  // 外周
  wallZ(-14,-9,9,y,MAT.wall,eDoorGap);          // 西（非常階段側）
  wallZ( 14,-9,9,y,MAT.wall,eDoorGap);          // 東（EV側）
  wallX(  9,-14,14,y,MAT.wall,[]);              // 北
  wallX( -9,-14,14,y,MAT.wall, fi===0?[[-1.6,1.6]]:[]); // 南（1Fは玄関）

  if(fi===0){
    // 1F：北側は封鎖、南側は吹き抜けのロビー
    wallX(2.5,-14,14,y,MAT.wallDark,[[-0.75,0.75]]);
    // 北側は封鎖区画。設備室(x-4.2..4.2)だけ残して両側を埋める
    blocker(10.0,3.4,6.6, -9.2,y+1.7,5.9);
    blocker(10.0,3.4,6.6,  9.2,y+1.7,5.9);
    wallZ(-4.2,2.5,9,y,MAT.wall,[]);
    wallZ( 4.2,2.5,9,y,MAT.wall,[]);
    makeDoor({x:0,y:y,z:2.5,axis:"x",width:1.5,hingeSign:-1,locked:false,
      name:"設備室 1A",sign:"1A",faceSign:-1});
    buildBasement(y);
    // 受付カウンター
    box(6,1.05,0.7, -4,y+0.52,-4.4,MAT.wood);
    box(0.7,1.05,3, -7.35,y+0.52,-2.9,MAT.wood);
    // 玄関ドア（ガラス2枚）
    makeFrontDoor(y);
    // ソファ
    box(2.2,0.45,0.9, 6.5,y+0.22,-6.2,MAT.dark);
    box(2.2,0.5,0.3, 6.5,y+0.7,-6.6,MAT.dark);
    box(1.2,0.4,0.7, 9.6,y+0.2,-4.0,MAT.dark);
  }else{
    // 廊下壁（開口は x=-7 と x=7）
    wallX( 2.5,-14,14,y,MAT.wall,[[-7.75,-6.25],[6.25,7.75]]);
    wallX(-2.5,-14,14,y,MAT.wall,[[-7.75,-6.25],[6.25,7.75]]);
    // 部屋の間仕切り
    wallZ(0, 2.5,9,y,MAT.wall,[]);
    wallZ(0,-9,-2.5,y,MAT.wall,[]);
    // ドアと内装
    for(const r of ROOMS[fi]){
      const dx = r.left?-7:7;
      const dz = r.side==="N"?2.5:-2.5;
      makeDoor({x:dx,y:y,z:dz,axis:"x",width:1.5,hingeSign:r.left?-1:1,
        locked:r.locked,keyId:r.keyId,name:r.name,sign:r.id,
        color:r.keyId?KEYCOL[r.keyId]:null,
        faceSign:r.side==="N"?-1:1});
      furnish(r,y);
    }
  }

  // 非常灯（赤）— 光源はフロアごとに1つだけ（GPU負荷対策）
  for(const xx of [-9,0,9]){
    const l=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.14,0.1),MAT.emerg);
    l.position.set(xx,y+2.75,2.36); scene.add(l);
  }
  const epl=new THREE.PointLight(0xff2e1c,0.40,26);
  epl.position.set(0,y+2.65,0); scene.add(epl);
  emergLights.push(epl); emergFloor.push(fi);
  // 蛍光灯（電源が入ると点灯。光源は持たず素材で表現）
  for(const xx of [-10,-4,4,10]){
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.08,0.5),MAT.lampOff);
    lamp.position.set(xx,y+CEIL-0.06,0); scene.add(lamp);
    ceilLamps.push({lamp,y:y});
  }
}
const ceilLamps=[];

function buildPhone(){
  const x=-11.4, y=0, z=2.28;
  const g=new THREE.Group(); g.position.set(x,y,z); scene.add(g);
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.72,0.24),MAT.phoneBody);
  body.position.y=1.35; g.add(body);
  const hood=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.10,0.32),MAT.phoneBody);
  hood.position.y=1.76; g.add(hood);
  const shelf=new THREE.Mesh(new THREE.BoxGeometry(0.56,0.05,0.34),MAT.dark);
  shelf.position.y=0.95; g.add(shelf);
  const hand=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.34,0.09),MAT.dark);
  hand.position.set(-0.26,1.38,-0.10); hand.rotation.z=0.12; g.add(hand);
  const pad=new THREE.Mesh(new THREE.PlaneGeometry(0.24,0.3),
    new THREE.MeshBasicMaterial({color:0x2a3038}));
  pad.position.set(0.05,1.35,-0.13); pad.rotation.y=Math.PI; g.add(pad);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.16),
    new THREE.MeshBasicMaterial({map:label("PUBLIC PHONE","#1f5c8c","#e8eef5",256,80)}));
  sign.position.set(0,1.86,-0.14); sign.rotation.y=Math.PI; g.add(sign);
  phoneMesh=g;
  interacts.push({
    pos:new THREE.Vector3(x,y+1.3,z-0.5), r:2.3,
    label:()=>{
      if(flags.called) return "公衆電話（通報済み）";
      return choiceOpen?null:"公衆電話を使う";
    },
    use:()=>{
      if(flags.called){ say("もう伝えることはない。",2.2); return; }
      if(choiceOpen) return;
      openChoice("警察に電話しますか？","はい","いいえ",
        callPolice,()=>say("受話器を戻した。",2.2),"phone");
    }
  });
}
let choiceCtx=null;
function openChoice(text,la,lb,onYes,onNo,tag){
  choiceOpen=true; choiceCtx={onYes:onYes,onNo:onNo,tag:tag||""};
  choiceText.textContent=text;
  cb1El.innerHTML=la+"<small>KEY 1</small>";
  cb2El.innerHTML=lb+"<small>KEY 2</small>";
  choiceEl.style.display="block"; sfx("click");
}
function closeChoice(){ choiceOpen=false; choiceCtx=null; choiceEl.style.display="none"; }
function answerChoice(yes){
  const c=choiceCtx; closeChoice();
  if(!c) return;
  if(yes){ if(c.onYes) c.onYes(); } else if(c.onNo) c.onNo();
}
function callPolice(){
  flags.called=true;
  switchToCallBgm();
  runScript([
    [0.0,()=>{ sfx("dial"); say("受話器を上げ、110をまわした。\n…プルルル…プルルル…",2.6); }],
    [2.8,()=>{ sfx("pick"); say("『――こちら警察です』",2.2); }],
    [5.2,()=>{ say("『はい。すぐ救助に向かいます』",2.4); }],
    [7.8,()=>{ say("『あなたは屋上に避難してください』",3.0); }],
    [10.9,()=>{
      setObjective("屋上に逃げろ！");
      say("屋上へ向かおう。");
      rescueGroup.visible=true;
    }]
  ]);
}
function buildRescue(){
  rescueGroup=new THREE.Group(); rescueGroup.visible=false; scene.add(rescueGroup);
  heliGroup=new THREE.Group(); rescueGroup.add(heliGroup);
  const body=new THREE.Mesh(new THREE.BoxGeometry(2.3,2.0,5.4),MAT.heliBody);
  body.position.y=0.2; heliGroup.add(body);
  const nose=new THREE.Mesh(new THREE.SphereGeometry(1.15,14,10),MAT.heliGlass);
  nose.position.set(0,0.25,-2.7); nose.scale.set(1.0,0.85,1.25); heliGroup.add(nose);
  const boom=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.55,4.6),MAT.heliBody);
  boom.position.set(0,0.55,4.4); heliGroup.add(boom);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(0.16,1.5,1.0),MAT.heliBody);
  fin.position.set(0,1.35,6.4); heliGroup.add(fin);
  for(const sx of [-1.25,1.25]){
    const sk=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,4.4),MAT.metal);
    sk.position.set(sx,-1.35,-0.2); heliGroup.add(sk);
    for(const sz of [-1.4,1.4]){
      const st=new THREE.Mesh(new THREE.BoxGeometry(0.12,1.1,0.12),MAT.metal);
      st.position.set(sx,-0.85,sz); heliGroup.add(st);
    }
  }
  const mast=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.5,0.3),MAT.metal);
  mast.position.y=1.25; heliGroup.add(mast);
  heliRotor=new THREE.Group(); heliRotor.position.y=1.55; heliGroup.add(heliRotor);
  for(let i=0;i<4;i++){
    const bl=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.06,11.5),MAT.rotor);
    bl.rotation.y=i*Math.PI/2; heliRotor.add(bl);
  }
  heliTail=new THREE.Group(); heliTail.position.set(0.28,1.35,6.4); heliGroup.add(heliTail);
  for(let i=0;i<2;i++){
    const bl=new THREE.Mesh(new THREE.BoxGeometry(0.06,2.4,0.2),MAT.rotor);
    bl.rotation.z=i*Math.PI/2; heliTail.add(bl);
  }
  const nav=[[-1.3,0,0xd83a2a],[1.3,0,0x3ad84a],[0,6.6,0xffffff]];
  for(const q of nav){
    const l=new THREE.Mesh(new THREE.SphereGeometry(0.13,8,8),
      new THREE.MeshBasicMaterial({color:q[2]}));
    l.position.set(q[0],0.1,q[1]); heliGroup.add(l);
    flashers.push({m:l,ph:Math.random()});
  }
  const spot=new THREE.PointLight(0xdce8ff,1.15,34); spot.position.set(0,-1.0,-1.5);
  heliGroup.add(spot);
  heliLadder=new THREE.Group(); heliLadder.position.set(0,-1.5,0.6); heliGroup.add(heliLadder);
  for(const sx of [-0.24,0.24]){
    const rope=new THREE.Mesh(new THREE.BoxGeometry(0.05,HELI.LADDER,0.05),MAT.rope);
    rope.position.set(sx,-HELI.LADDER/2,0); heliLadder.add(rope);
  }
  const n=Math.floor(HELI.LADDER/0.42);
  for(let i=0;i<n;i++){
    const rung=new THREE.Mesh(new THREE.BoxGeometry(0.56,0.06,0.09),MAT.wood);
    rung.position.y=-0.42*(i+1); heliLadder.add(rung);
  }
  buildSurvivor();
}
// はしごにしがみつく主人公（簡素なブロック人形）
function buildSurvivor(){
  survivor=new THREE.Group();
  survivor.position.set(0,-HELI.LADDER+0.30,0.14);
  survivor.visible=false; heliLadder.add(survivor);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.40,0.54,0.24),MAT.survCloth);
  torso.position.y=0.90; survivor.add(torso);
  const hip=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.18,0.22),MAT.survPants);
  hip.position.y=0.55; survivor.add(hip);
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.26,0.28,0.25),MAT.survSkin);
  head.position.y=1.32; survivor.add(head);
  const hair=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.10,0.27),MAT.survHair);
  hair.position.y=1.47; survivor.add(hair);
  survHead=head;
  // 腕：桟をつかんで上に伸びる
  survArms=[];
  for(const sx of [-1,1]){
    const pa=new THREE.Group(); pa.position.set(sx*0.24,1.12,0); survivor.add(pa);
    const up=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.42,0.13),MAT.survCloth);
    up.position.y=0.21; pa.add(up);
    const lo=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.36,0.12),MAT.survSkin);
    lo.position.y=0.58; pa.add(lo);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.12,0.16),MAT.survSkin);
    hand.position.set(0,0.80,-0.05); pa.add(hand);
    pa.rotation.z=sx*0.10; pa.rotation.x=-0.18;
    survArms.push(pa);
  }
  // 脚：宙に垂れる
  survLegs=[];
  for(const sx of [-1,1]){
    const pl=new THREE.Group(); pl.position.set(sx*0.11,0.50,0); survivor.add(pl);
    const th=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.40,0.15),MAT.survPants);
    th.position.y=-0.20; pl.add(th);
    const sh=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.38,0.13),MAT.survPants);
    sh.position.y=-0.58; pl.add(sh);
    const ft=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.10,0.22),MAT.dark);
    ft.position.set(0,-0.80,-0.04); pl.add(ft);
    pl.rotation.x=sx*0.12;
    survLegs.push(pl);
  }
}
let heliSndOn=false;
function updateHeliSound(dt){
  if(!heliAudio) return;
  // 屋上にいる間だけ。距離とエンディング進行で音量を決める
  let want=0;
  if(rescueGroup&&rescueGroup.visible&&!dead){
    if(ending.active){
      // 掴んだ後は最大音量、上昇で少しずつ引く
      want = ending.phase==="grab" ? 1.0 : Math.max(0.45,1.0-ending.t*0.05);
      if(cleared) want=0;
    }else if(player.pos.y>ROOF_Y-1.2){
      const d=Math.hypot(player.pos.x-heliPos.x,player.pos.z-heliPos.z,player.pos.y-heliPos.y);
      want=Math.max(0.42,Math.min(1.0,1.0-(d-9)/26));
    }else if(player.pos.y>8.5){
      want=0.14;                      // 塔屋・階段の最上部でうっすら聞こえる
    }
  }
  if(want>0&&!heliSndOn){
    heliSndOn=true; heliAudio.volume=0;
    const p=heliAudio.play(); if(p&&p.catch) p.catch(()=>{});
  }
  const sp = want>heliAudio.volume ? 1.6 : 1.1;
  heliAudio.volume=Math.max(0,Math.min(1,heliAudio.volume+(want-heliAudio.volume)*Math.min(1,dt*sp)));
  if(heliSndOn&&want===0&&heliAudio.volume<0.02){ heliAudio.pause(); heliSndOn=false; }
}
function updateHeli(dt){
  updateHeliSound(dt);
  if(!rescueGroup||!rescueGroup.visible) return;
  heliRotor.rotation.y+=dt*26;
  heliTail.rotation.x+=dt*34;
  if(survivor&&survivor.visible){
    survT+=dt;
    const t=survT;
    survivor.rotation.z=Math.sin(t*1.5)*0.09;      // 風にあおられて揺れる
    survivor.rotation.x=Math.sin(t*1.1+0.7)*0.06;
    survLegs[0].rotation.x= 0.12+Math.sin(t*1.9)*0.16;
    survLegs[1].rotation.x=-0.12+Math.sin(t*1.9+1.2)*0.16;
    survArms[0].rotation.z= 0.10+Math.sin(t*2.3)*0.03;
    survArms[1].rotation.z=-0.10-Math.sin(t*2.3)*0.03;
    survHead.rotation.x=-0.20+Math.sin(t*0.9)*0.05;
  }
  if(ending.active&&ending.phase!=="grab") return;
  heliAng+=dt*HELI.SPD;
  heliPos.set(Math.cos(heliAng)*HELI.R, HELI.H+Math.sin(heliAng*1.7)*0.5, Math.sin(heliAng)*HELI.R);
  heliGroup.position.copy(heliPos);
  heliGroup.rotation.y=-heliAng;
  heliLadder.rotation.z=Math.sin(heliAng*2.2)*0.05;
  heliLadder.rotation.x=Math.sin(heliAng*1.6)*0.04;
}
function ladderTip(out){
  const a=heliAng;
  out.set(heliPos.x+Math.sin(-a)*0.6, heliPos.y-1.5-HELI.LADDER+0.5, heliPos.z+Math.cos(-a)*0.6);
  return out;
}
function buildBasement(y1){
  const y=BASE_Y, H=CEIL_B;
  // 床と天井
  const f1=new THREE.Mesh(new THREE.BoxGeometry(3.2,0.4,22.4),MAT.concrete);
  f1.position.set(0,y-0.2,-3); scene.add(f1);
  const c1=new THREE.Mesh(new THREE.BoxGeometry(3.2,0.2,22.4),MAT.concrete);
  c1.position.set(0,y+H+0.1,-3); scene.add(c1);
  const f2=new THREE.Mesh(new THREE.BoxGeometry(8.8,0.4,6.4),MAT.concrete);
  f2.position.set(0,y-0.2,-17); scene.add(f2);
  const c2=new THREE.Mesh(new THREE.BoxGeometry(8.8,0.2,6.4),MAT.concrete);
  c2.position.set(0,y+H+0.1,-17); scene.add(c2);
  // 廊下・小部屋の外側は地中。万一にも出られないよう当たり判定で埋める
  blocker(9.0,H+1.0,22.4, -5.95,y+H/2,-3);
  blocker(9.0,H+1.0,22.4,  5.95,y+H/2,-3);
  blocker(20.0,H+1.0,6.4, -14.3,y+H/2,-17);
  blocker(20.0,H+1.0,6.4,  14.3,y+H/2,-17);
  blocker(30.0,H+1.0,6.0,  0,y+H/2,-23.2);
  // 細い廊下
  wallZ(-1.45,-14,8.1,y,MAT.concrete,[],H);
  wallZ( 1.45,-14,8.1,y,MAT.concrete,[],H);
  wallX( 8.1,-1.45,1.45,y,MAT.concrete,[],H);
  // 突き当りの扉
  wallX(-14,-4.25,4.25,y,MAT.concrete,[[-0.75,0.75]],H);
  makeDoor({x:0,y:y,z:-14,axis:"x",width:1.5,hingeSign:-1,locked:false,
    name:"地下の扉",sign:"B1",faceSign:1});
  // 小部屋
  wallZ(-4.25,-20,-14,y,MAT.concrete,[],H);
  wallZ( 4.25,-20,-14,y,MAT.concrete,[],H);
  wallX(-20,-4.25,4.25,y,MAT.concrete,[],H);
  box(1.2,1.9,0.42,-3.0,y+0.95,-19.5,MAT.metal);
  box(1.2,1.9,0.42, 3.0,y+0.95,-19.5,MAT.metal);
  // 照明（裸電球）
  for(const bz of [-1,-11,-17]){
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),MAT.lampOff);
    bulb.position.set(0,y+H-0.28,bz); scene.add(bulb);
    const cord=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.3,0.02),MAT.dark);
    cord.position.set(0,y+H-0.12,bz); scene.add(cord);
  }
  // 梯子（地下 → 1F）
  const lad=new THREE.Group(); lad.position.set(0,y,7.4); scene.add(lad);
  for(const sx of [-0.28,0.28]){
    const rail=new THREE.Mesh(new THREE.BoxGeometry(0.07,4.6,0.07),MAT.metal);
    rail.position.set(sx,2.3,0); lad.add(rail);
  }
  for(let i=0;i<15;i++){
    const rung=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.05,0.05),MAT.metal);
    rung.position.set(0,0.25+i*0.3,0); lad.add(rung);
  }
  // 1F側のハッチ（開口の見た目）
  const hole=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.5),
    new THREE.MeshBasicMaterial({color:0x05070a}));
  hole.rotation.x=-Math.PI/2; hole.position.set(0,0.012,7.0); scene.add(hole);
  for(const q of [[0,7.82,1.7,0.16],[0,6.18,1.7,0.16],[-0.85,7.0,0.16,1.5],[0.85,7.0,0.16,1.5]])
    box(q[2],0.14,q[3],q[0],0.07,q[1],MAT.metal,{los:false});
  // 昇降のインタラクト
  interacts.push({
    pos:new THREE.Vector3(0,1.0,6.2), r:2.0,
    label:()=> climb.active?null:"梯子で地下へ降りる",
    use:()=>{ if(!climb.active) startClimb(0,BASE_Y,6.6,true); }
  });
  interacts.push({
    pos:new THREE.Vector3(0,BASE_Y+1.0,6.9), r:2.0,
    label:()=> climb.active?null:"梯子で1階へ昇る",
    use:()=>{ if(!climb.active) startClimb(0,0,6.1,false); }
  });
}
function buildRoof(){
  const y=ROOF_Y;
  // 屋上スラブ
  const slab=new THREE.Mesh(new THREE.BoxGeometry(28.4,0.6,18.4),MAT.roof);
  slab.position.set(0,y-0.3,0); scene.add(slab);
  // パラペット（転落防止）。塔屋とエレベーター機械室が占める z-3..3 は除く
  const PH=1.1;
  box(28.4,PH,0.3, 0,y+PH/2, 9.15,MAT.roofWall);
  box(28.4,PH,0.3, 0,y+PH/2,-9.15,MAT.roofWall);
  for(const sx of [-1,1]){
    const X=sx*14.15;
    box(0.3,PH,6.2, X,y+PH/2, 6.1,MAT.roofWall);
    box(0.3,PH,6.2, X,y+PH/2,-6.1,MAT.roofWall);
  }
  // ヘリポートの円マーク
  const hp=new THREE.Mesh(new THREE.CircleGeometry(4.6,36),
    new THREE.MeshBasicMaterial({color:0xe8a13a,transparent:true,opacity:0.22}));
  hp.rotation.x=-Math.PI/2; hp.position.set(0,y+0.02,0); scene.add(hp);
  const hp2=new THREE.Mesh(new THREE.CircleGeometry(3.4,36),
    new THREE.MeshBasicMaterial({color:0x05070a,transparent:true,opacity:0.30}));
  hp2.rotation.x=-Math.PI/2; hp2.position.set(0,y+0.03,0); scene.add(hp2);
  // 屋上の常夜灯（控えめ）
  const l=new THREE.PointLight(0x9fb8e0,0.0,60); l.position.set(0,y+14,-6); scene.add(l);
  roofLight=l;
}
function buildSky(){
  const N=1500, pos=new Float32Array(N*3), col=new Float32Array(N*3), R=94;
  for(let i=0;i<N;i++){
    const u=Math.random()*Math.PI*2, yy=Math.pow(Math.random(),0.55), r=Math.sqrt(1-yy*yy);
    pos[i*3]=Math.cos(u)*r*R; pos[i*3+1]=yy*R+3; pos[i*3+2]=Math.sin(u)*r*R;
    const t=0.45+Math.random()*0.55;
    col[i*3]=t*0.92; col[i*3+1]=t*0.95; col[i*3+2]=t;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));
  g.setAttribute("color",new THREE.BufferAttribute(col,3));
  skyGroup=new THREE.Group(); scene.add(skyGroup);
  skyGroup.add(new THREE.Points(g,new THREE.PointsMaterial({
    size:1.8,sizeAttenuation:false,vertexColors:true,fog:false,transparent:true,opacity:0.9})));
  const moon=new THREE.Mesh(new THREE.CircleGeometry(4.0,36),
    new THREE.MeshBasicMaterial({color:0xe4ecf7,fog:false}));
  moon.position.set(-34,48,-70); moon.lookAt(0,0,0); skyGroup.add(moon);
  const halo=new THREE.Mesh(new THREE.CircleGeometry(9.0,36),
    new THREE.MeshBasicMaterial({color:0x8fa6c8,fog:false,transparent:true,opacity:0.13}));
  halo.position.set(-34,48,-70); halo.lookAt(0,0,0); skyGroup.add(halo);
}
const RESERVED=[{x:7,z:8.4,r:2.2}];   // 電源盤の前（2B/3B）
function isReserved(x,z){
  for(const q of RESERVED) if(Math.hypot(x-q.x,z-q.z)<q.r) return true;
  return false;
}
function furnish(r,y){
  const x0=r.left?-13.4:0.9, x1=r.left?-0.9:13.4;
  const z0=r.side==="N"?3.1:-8.4, z1=r.side==="N"?8.4:-3.1;
  const rand=mulberry(r.id.charCodeAt(0)*97+r.id.charCodeAt(1)*13+y*7);
  // 机
  for(let i=0;i<4;i++){
    const w=1.5,d=0.8;
    let x=0,z=0,tries=0;
    do{ x=x0+0.9+rand()*(x1-x0-2.0); z=z0+0.9+rand()*(z1-z0-2.0); tries++; }
    while(isReserved(x,z)&&tries<24);
    if(isReserved(x,z)) continue;
    box(w,0.06,d,x,y+0.74,z,MAT.wood);
    box(0.08,0.72,0.08,x-w/2+0.1,y+0.36,z-d/2+0.1,MAT.dark,{los:false});
    box(0.08,0.72,0.08,x+w/2-0.1,y+0.36,z+d/2-0.1,MAT.dark,{los:false});
    if(rand()<0.6){ // モニタ
      box(0.5,0.34,0.05,x,y+0.95,z-0.15,MAT.dark,{collide:false,los:false});
    }
  }
  // 棚
  for(let i=0;i<2;i++){
    const zz=r.side==="N"?z1-0.35:z0+0.35;
    let x=0,tries=0;
    do{ x=x0+0.6+rand()*(x1-x0-1.2); tries++; } while(isReserved(x,zz)&&tries<24);
    if(isReserved(x,zz)) continue;
    box(1.1,1.9,0.42,x,y+0.95,zz,MAT.metal);
  }
}

/* ---------- 正面玄関（1F） ---------- */
let exitDoor=null;
function makeFrontDoor(y){
  const frame=new THREE.Group(); scene.add(frame);
  const panels=[];
  for(const s of [-1,1]){
    const p=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.3,0.08),MAT.glass);
    p.position.set(s*0.78,y+1.15,-9); frame.add(p);
    const bar=new THREE.Mesh(new THREE.BoxGeometry(1.55,0.07,0.11),MAT.metal);
    bar.position.set(s*0.78,y+1.05,-9); frame.add(bar);
    panels.push({p,bar,s});
  }
  const col={box:new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(0,y+1.15,-9),new THREE.Vector3(3.2,2.3,0.4)),active:true,tag:"exit"};
  colliders.push(col);

  exitDoor={open:false,t:0,panels,col};
  tickers.push(dt=>{
    const tgt=exitDoor.open?1:0;
    if(Math.abs(exitDoor.t-tgt)>0.001){
      exitDoor.t+=(tgt-exitDoor.t)*Math.min(1,dt*2.2);
      for(const q of exitDoor.panels){
        q.p.position.x=q.s*(0.78+exitDoor.t*1.5);
        q.bar.position.x=q.p.position.x;
      }
    }
  });
  interacts.push({
    pos:new THREE.Vector3(0,y+1.2,-8.6), r:2.6,
    label:()=> "正面玄関（電子ロック）",
    use:()=>{
      sfx("locked");
      say("電子ロックが降りたままだ。\n指をかけても、びくともしない。",3.6);
    }
  });
  // 外構
  const gr=new THREE.Mesh(new THREE.PlaneGeometry(90,70),MAT.asphalt);
  gr.rotation.x=-Math.PI/2; gr.position.set(0,-0.02,-40); scene.add(gr);
  const moon=new THREE.PointLight(0xa8bcdc,0.80,68); moon.position.set(0,15,-24); scene.add(moon);
  for(const px of [-10,10]){
    box(0.16,4.6,0.16,px,2.3,-16,MAT.metal,{los:false});
    const lp=new THREE.Mesh(new THREE.SphereGeometry(0.3,10,10),MAT.lampOn);
    lp.position.set(px,4.6,-16); scene.add(lp);
  }
}

/* ============================================================
   非常階段
   ============================================================ */
function stairSurface(x,z,L){
  if(z<-3||z>3) return null;
  if(x>=-17&&x<=-14) return L;                 // 各階の踊り場
  if(x>=-21&&x<-17){
    if(L<=0) return null;                      // 地下へは続かない
    const t=(-17-x)/4;
    return z<0 ? L-2*t : L-4+2*t;
  }
  if(x>=-22.7&&x<-21){ return L<=0?null:L-2; } // 折返し踊り場
  return null;
}
function buildStairs(){
  // 外壁（3層ぶち抜き）
  const H=15.6, W=8.9;   // 屋上の塔屋ぶんまで立ち上げる
  box(T,H,6.4,-22.8,H/2,0,MAT.concrete);
  box(W,H,T,-18.35,H/2,3.1,MAT.concrete);
  box(W,H,T,-18.35,H/2,-3.1,MAT.concrete);
  box(W,0.3,6.4,-18.35,15.7,0,MAT.concrete);      // 塔屋の天井
  box(4.0,H,0.24,-19,H/2,0,MAT.concrete);         // 中央の仕切り壁（転落防止）
  // 最上階(3F)の「上り側」と最下階(1F)の「下り側」はその先に階段が存在しない。
  // ふさがないと3Fでは4mの落差、1Fでは階段下の空洞に入り込んで戻れなくなる。
  box(T,3.4,3.1,-17,ROOF_Y+1.7,1.55,MAT.concrete); // 屋上 踊り場・上り側（最上部）
  box(T,3.4,3.1,-17,1.7,-1.55,MAT.concrete);       // 1F 踊り場・下り側（最下部）
  // 塔屋の壁（屋上側）。ここに屋上へ出る扉がつく
  box(T,0.8,6.2,-14,11.6,0,MAT.concrete,{los:false});
  wallZ(-14,-3,3,ROOF_Y,MAT.concrete,[[-0.9,0.9]],3.6);
  const base=new THREE.Mesh(new THREE.BoxGeometry(W,0.3,6.4),MAT.concrete);
  base.position.set(-18.35,-0.15,0); scene.add(base);

  const sl=new THREE.PointLight(0xff3a26,0.42,30); sl.position.set(-17.5,7.5,0); scene.add(sl);
  emergLights.push(sl); emergFloor.push(-1);
  for(const L of [0,4,8,12]){
    // 各階の踊り場
    const p=new THREE.Mesh(new THREE.BoxGeometry(3,0.24,6),MAT.concrete);
    p.position.set(-15.5,L-0.12,0); scene.add(p);
    if(L>0){
      // 折返し踊り場
      const m=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.24,6),MAT.concrete);
      m.position.set(-21.9,L-2-0.12,0); scene.add(m);
      // 段（見た目）
      for(let i=0;i<10;i++){
        const t0=i/10,t1=(i+1)/10;
        const xA=-17-t0*4;
        const sA=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.22,2.8),MAT.concrete);
        sA.position.set(xA-0.2,L-2*t1+0.11,-1.55); scene.add(sA);
        const sB=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.22,2.8),MAT.concrete);
        sB.position.set(xA-0.2,L-4+2*t0+0.11,1.55); scene.add(sB);
      }
    }
    // 階数表示
    const sg=new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.42),
      new THREE.MeshBasicMaterial({map:label(FLOOR_NAME[L/4],"#2a2f36","#e8a13a",256,128)}));
    sg.position.set(-16.6,L+2.0,-2.95); sg.rotation.y=0; scene.add(sg);

  }
}

/* ============================================================
   エレベーター
   ============================================================ */
const elev={y:0,floor:0,target:0,state:"closed",doorT:0,doors:[],platform:null};
function buildElevator(){
  const H=15.0;
  box(T,H,6.4,20.1,H/2,0,MAT.metal);
  box(6.2,H,T,17,H/2,3.1,MAT.metal);
  box(6.2,H,T,17,H/2,-3.1,MAT.metal);
  box(6.2,0.3,6.4,17,15.1,0,MAT.metal);
  box(T,H-11.2,6.4,14,(11.2+H)/2,0,MAT.metal);   // 屋上に立つ機械室の壁
  const pit=new THREE.Mesh(new THREE.BoxGeometry(6.2,0.3,6.4),MAT.dark);
  pit.position.set(17,-0.2,0); scene.add(pit);

  // かご（プラットフォーム）
  const g=new THREE.Group(); scene.add(g);
  const fl=new THREE.Mesh(new THREE.BoxGeometry(5.6,0.2,5.6),MAT.metal); fl.position.y=-0.1; g.add(fl);
  const cl=new THREE.Mesh(new THREE.BoxGeometry(5.6,0.16,5.6),MAT.dark); cl.position.y=2.5; g.add(cl);
  const lm=new THREE.Mesh(new THREE.BoxGeometry(1.6,0.06,1.0),MAT.lampOff); lm.position.y=2.4; g.add(lm);
  const cage=new THREE.PointLight(0xdfe7f0,0,8); cage.position.y=2.2; g.add(cage);
  const panel=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.9,0.34),MAT.dark);
  panel.position.set(-2.6,1.3,1.8); g.add(panel);
  g.position.set(17,0,0);
  elev.platform=g; elev.lamp=lm; elev.light=cage;

  // 各階の扉
  for(let fi=0;fi<3;fi++){
    const y=fi*FH;
    const p=new THREE.Mesh(new THREE.BoxGeometry(0.1,2.2,1.8),MAT.metal);
    p.position.set(14,y+1.1,0.0); scene.add(p); losBlockers.push(p);
    const col={box:new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(14,y+1.1,0),new THREE.Vector3(0.4,2.2,1.9)),active:true,tag:"ev"};
    colliders.push(col);
    elev.doors.push({p,col,fi,y});

    // 呼びボタン
    const b=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.28,0.2),MAT.dark);
    b.position.set(13.85,y+1.25,1.35); scene.add(b);
    const lite=new THREE.Mesh(new THREE.SphereGeometry(0.045,8,8),MAT.lampOff);
    lite.position.set(13.79,y+1.32,1.35); scene.add(lite);
    elev.doors[fi].callLite=lite;
    interacts.push({
      pos:new THREE.Vector3(13.7,y+1.25,1.35), r:2.0,
      label:()=> flags.power? "エレベーターを呼ぶ" : "エレベーターの呼びボタン（無反応）",
      use:()=>{
        if(!flags.power){ say("ボタンは沈むだけで、何も起きない。\n電源が落ちているようだ。"); sfx("locked"); return; }
        if(elev.state==="moving"){ say("エレベーターは移動中だ。"); return; }
        if(elev.floor===fi&&elev.state==="open"){ say("エレベーターはもう来ている。"); return; }
        elevGoTo(fi); say("エレベーターを呼んだ。");
      }
    });
    // 階数表示
    const sg=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.32),
      new THREE.MeshBasicMaterial({map:label(FLOOR_NAME[fi],"#1c2027","#e8a13a",256,128)}));
    sg.position.set(13.86,y+2.3,0); sg.rotation.y=-Math.PI/2; scene.add(sg);
  }
}
function elevGoTo(fi){
  if(!flags.power) return;
  if(elev.state==="moving") return;
  elev.target=fi;
  if(elev.floor===fi&&(elev.state==="open"||elev.state==="opening")) return;
  elev.state = (elev.state==="closed") ? "moving" : "closing";
  sfx("bell");
}
function updateElev(dt){
  const d=elev.doors[elev.floor];
  if(elev.state==="closing"){
    elev.doorT-=dt*1.6;
    if(elev.doorT<=0){ elev.doorT=0; elev.state="moving"; }
  }else if(elev.state==="opening"){
    elev.doorT+=dt*1.6;
    if(elev.doorT>=1){ elev.doorT=1; elev.state="open"; }
  }else if(elev.state==="moving"){
    const ty=elev.target*FH;
    const dir=Math.sign(ty-elev.y);
    elev.y+=dir*dt*1.7;
    if((dir>0&&elev.y>=ty)||(dir<0&&elev.y<=ty)||dir===0){
      elev.y=ty; elev.floor=elev.target; elev.state="opening"; sfx("bell");
    }
  }
  elev.platform.position.y=elev.y;
  // 扉の見た目と当たり判定
  for(const dd of elev.doors){
    const opening = (dd.fi===elev.floor) ? elev.doorT : 0;
    dd.p.position.z = -opening*1.85;
    dd.col.active = opening<0.55;
    dd.callLite.material = (flags.power && dd.fi===elev.floor)?MAT.lampOn:MAT.lampOff;
  }
  elev.light.intensity = flags.power?0.70:0.0;
  elev.lamp.material = flags.power?MAT.lampOn:MAT.lampOff;
}

/* ============================================================
   ゾンビ
   ============================================================ */
function makeZombie(x,floorY,zz){
  const sp=freeSpot(x,zz,floorY,ZOMBIE_R+0.05); x=sp[0]; zz=sp[1];
  const g=new THREE.Group(); g.position.set(x,floorY,zz); scene.add(g);
  const vis=new THREE.Group(); g.add(vis);        // ここを3Dモデルに差し替える
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.95,0.3),MAT.zombie); body.position.y=1.12; vis.add(body);
  const hip=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.22,0.28),MAT.zombie); hip.position.y=0.66; vis.add(hip);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.19,12,10),MAT.zombieSkin); head.position.y=1.79; vis.add(head);
  const eyes=[];   // 目のメッシュは持たせない
  const arms=[],legs=[];
  for(const s of [-1,1]){
    const pa=new THREE.Group(); pa.position.set(s*0.33,1.5,0); vis.add(pa);
    const a=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.72,0.14),MAT.zombieSkin); a.position.y=-0.36; pa.add(a);
    pa.rotation.x=-1.35; arms.push(pa);
    const pl=new THREE.Group(); pl.position.set(s*0.14,0.62,0); vis.add(pl);
    const l=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.62,0.17),MAT.zombie); l.position.y=-0.31; pl.add(l);
    legs.push(pl);
  }
  const z={
    g,vis,head,arms,legs,eyes,floorY, y:floorY,
    model:null, mixer:null, action:null, bones:null, phase:Math.random()*20, downTotal:0,
    wMixer:null, wAction:null, wPhase:0, walking:false,
    pos:new THREE.Vector3(x,floorY,zz),
    home:new THREE.Vector3(x,floorY,zz),
    dir:Math.random()*Math.PI*2, state:"idle", lose:0, t:Math.random()*10, stagger:0, calm:0,
    down:0, fall:0,
    losT:Math.random(), seen:false, stuck:0, side:0, wanderT:0
  };
  zombies.push(z);
  if(ZMODEL.ready) attachModel(z);
  return z;
}
/* ===== ゾンビの3Dモデル（GLB埋め込み） ===== */
const ZMODEL={ ready:false, scene:null, clip:null, walk:null, scale:1, yOff:0, yaw:0, axes:null, base:null };
// 通報後、2F/3F/屋上の個体は歩行クリップに切り替わり、動きも速くなる
const ALERT_SPEED=1.85, ALERT_SIGHT=26, ALERT_LOSE=11.0, ALERT_TURN=5.0;
function isAlertZone(y){ return y>2.0; }        // 2F(4)/3F(8)/屋上(12)
function zombieAlert(z){ return flags.called && isAlertZone(z.y); }
const USE_CLIP_ANIM=false;   // true にすると同梱アニメを再生。false は従来どおりの手続き動作
const POSE_T=0.6;            // 手続き動作の土台にする静止ポーズの時刻（秒）
const BONE_KEYS={LUL:"LeftUpLeg",RUL:"RightUpLeg",LA:"LeftArm",RA:"RightArm"};
// 同梱クリップはアイドル1本（約6.1秒）
const CLIP={ LOOP_A:0.05, LOOP_B:6.0 };
function toLambert(mat){
  const tr=!!mat.transparent;
  const m=new THREE.MeshLambertMaterial({
    map:mat.map||null, color:mat.color?mat.color.clone():new THREE.Color(0xffffff),
    skinning:true, side:tr?THREE.DoubleSide:THREE.FrontSide,
    transparent:tr, alphaTest:tr?0.08:0, depthWrite:!tr
  });
  if(m.map) m.map.encoding=THREE.sRGBEncoding;
  return FX.skinMat(m,mat);
}
function loadZombieModel(){
  const buf=window.ASSETS&&ASSETS.zombie;
  if(!buf||!THREE.GLTFLoader) return;
  new THREE.GLTFLoader().parse(buf,"",(gltf)=>{
    const root=gltf.scene;
    root.traverse(o=>{
      if(o.isMesh||o.isSkinnedMesh){
        o.material=Array.isArray(o.material)?o.material.map(toLambert):toLambert(o.material);
        o.frustumCulled=false;
      }
    });
    // 実寸に合わせる（身長1.85m・足元をy=0に）
    root.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(root);
    const h=box.max.y-box.min.y;
    ZMODEL.scale = h>0 ? 1.85/h : 1;
    ZMODEL.yOff  = -box.min.y*ZMODEL.scale;
    ZMODEL.scene = root;
    const anims=gltf.animations||[];
    const byName=(n)=>anims.filter(a=>a.name&&a.name.toLowerCase().indexOf(n)>=0)[0];
    ZMODEL.clip = byName("idle") || anims[0] || null;
    ZMODEL.walk = byName("walk") || (anims.length>1?anims[1]:null);
    FX.zombieClips(anims);
    ZMODEL.ready = true;
    for(const z of zombies) attachModel(z);
  },()=>{ /* 失敗時は簡易モデルのまま */ });
}
function findBones(root){
  const out={};
  root.traverse(o=>{
    for(const k in BONE_KEYS) if(!out[k]&&o.name&&o.name.indexOf(BONE_KEYS[k])>=0) out[k]=o;
  });
  return out;
}
// ルート基準での親の向き（ワールドのyawに依存しない）
function accumQuat(bone,root){
  const q=new THREE.Quaternion(), chain=[];
  let n=bone.parent;
  while(n&&n!==root){ chain.push(n); n=n.parent; }
  for(let i=chain.length-1;i>=0;i--) q.multiply(chain[i].quaternion);
  return q;
}
function buildBoneRig(inst,bones){
  if(ZMODEL.axes) return;
  const axes={}, base={};
  for(const k in bones){
    const b=bones[k]; if(!b) continue;
    const pq=accumQuat(b,inst);
    axes[k]=new THREE.Vector3(1,0,0).applyQuaternion(pq.clone().invert()).normalize();
    base[k]=b.quaternion.clone();
  }
  ZMODEL.axes=axes; ZMODEL.base=base;
}
const _q=new THREE.Quaternion();
function swingBone(b,axis,base,ang){
  if(!b||!axis||!base) return;
  b.quaternion.copy(base).premultiply(_q.setFromAxisAngle(axis,ang));
}
function animateModelProc(z){
  const w=z.state==="chase"?7.0:3.2, amp=z.state==="chase"?0.62:0.3;
  const sw=Math.sin(z.t*w), aw=Math.sin(z.t*w+1);
  const A=ZMODEL.axes, B=ZMODEL.base;
  if(A&&B){
    swingBone(z.bones.LUL,A.LUL,B.LUL, sw*amp);
    swingBone(z.bones.RUL,A.RUL,B.RUL,-sw*amp);
    swingBone(z.bones.LA ,A.LA ,B.LA ,  aw*0.16);
    swingBone(z.bones.RA ,A.RA ,B.RA , -aw*0.16);
  }
  z.g.rotation.z=Math.sin(z.t*w*0.5)*0.06;
}
function attachModel(z){
  if(!ZMODEL.ready||z.model) return;
  const inst=THREE.SkeletonUtils?THREE.SkeletonUtils.clone(ZMODEL.scene):ZMODEL.scene.clone(true);
  inst.scale.setScalar(ZMODEL.scale);
  inst.position.y=ZMODEL.yOff;
  inst.rotation.y=ZMODEL.yaw;
  FX.zombieVariant(inst,zombies.indexOf(z)+1);
  z.g.remove(z.vis);
  z.g.add(inst);
  z.model=inst;
  if(FX.zombieAttach(z,inst)) return;
  if(ZMODEL.clip){
    const mixer=new THREE.AnimationMixer(inst);
    const act=mixer.clipAction(ZMODEL.clip);
    act.play(); act.paused=true;             // 時間はこちらで指定する
    if(USE_CLIP_ANIM){ z.mixer=mixer; z.action=act; }
    else{
      act.time=POSE_T; mixer.update(0);      // 立ちポーズを焼き込んで以後は動かさない
      inst.updateMatrixWorld(true);
      z.bones=findBones(inst);
      buildBoneRig(inst,z.bones);
      z.mixer=null; z.action=null;
      if(ZMODEL.walk){                       // 通報後に使う歩行アニメ
        z.wMixer=mixer;
        z.wAction=mixer.clipAction(ZMODEL.walk);
        z.wAction.play(); z.wAction.paused=true;
        act.stop();
        z.wPhase=Math.random()*ZMODEL.walk.duration;
      }
    }
  }
}
function poseZombie(z,t){
  if(!z.mixer||!z.action) return;
  const d=ZMODEL.clip.duration;
  z.action.time=Math.max(0,Math.min(d-0.001,t));
  z.mixer.update(0);
}
function losClear(from,to){
  const d=new THREE.Vector3().subVectors(to,from);
  const dist=d.length(); if(dist<0.2) return true;
  d.normalize();
  const ray=new THREE.Raycaster(from,d,0.2,dist-0.2);
  const hits=ray.intersectObjects(losBlockers,false);
  return hits.length===0;
}
const _tmpA=new THREE.Vector3(),_tmpB=new THREE.Vector3();
function updateZombies(dt){
  const pEye=_tmpA.set(player.pos.x,player.pos.y+1.3,player.pos.z);
  for(const z of zombies){
    z.t+=dt;
    if(z.calm>0) z.calm-=dt;
    if(z.down>0){
      z.down-=dt;
      if(!FX.zombieDownAnim(z,dt)){
        const tgt = z.down>1.2 ? 1 : Math.max(0,z.down/1.2);
        z.fall += (tgt-z.fall)*Math.min(1,dt*6);
        z.g.rotation.x=-1.45*z.fall;
        z.g.rotation.z=Math.sin(z.t*13)*0.06*z.fall;
      }
      if(z.down<=0){
        z.down=0; z.fall=0; z.g.rotation.x=0; z.g.rotation.z=0;
        z.state="idle"; z.calm=1.0; z.seen=false; sfx("groan");
      }
      continue;
    }
    if(z.stagger>0){
      z.stagger-=dt;
      z.g.rotation.z=Math.sin(z.t*22)*0.16;
      continue;
    }
    const dx=player.pos.x-z.pos.x, dz=player.pos.z-z.pos.z;
    const dist=Math.hypot(dx,dz);
    const sameFloor=Math.abs(z.y-player.pos.y)<2.4;

    // 索敵
    z.losT-=dt;
    if(z.losT<=0){
      z.losT=0.28+Math.random()*0.14;
      z.seen=false;
      if(sameFloor&&dist<(zombieAlert(z)?ALERT_SIGHT:15)){
        const hd=_tmpB.set(z.pos.x,z.y+1.75,z.pos.z);
        if(losClear(hd,pEye)){
          const fx=Math.sin(z.dir),fz=Math.cos(z.dir);
          const dot=(dx*fx+dz*fz)/(dist||1);
          if(dot>-0.25||dist<5.5) z.seen=true;
        }
      }
    }
    if(z.seen){
      if(z.state!=="chase"){ z.state="chase"; sfx("groan"); }
      z.lose=0;
    }else if(z.state==="chase"){
      z.lose+=dt;
      const lim=zombieAlert(z)?ALERT_LOSE:5.0;
      if(z.lose>lim||dist>(zombieAlert(z)?32:20)||!sameFloor) z.state="idle";
    }

    let speed=0, tx=0,tz=0;
    if(z.state==="chase"){
      speed=zombieAlert(z)?ALERT_SPEED:1.15; tx=dx; tz=dz;
      if(z.side!==0){ tx+= -dz*z.side*1.2; tz+= dx*z.side*1.2; }
    }else{
      z.wanderT-=dt;
      if(z.wanderT<=0){
        z.wanderT=2.5+Math.random()*3.5;
        z.dir=Math.random()*Math.PI*2;
        if(Math.random()<0.35) z.wanderT=1.2, speed=0;
      }
      const hx=z.home.x-z.pos.x, hz=z.home.z-z.pos.z;
      if(Math.hypot(hx,hz)>9){ z.dir=Math.atan2(hx,hz); }
      speed=zombieAlert(z)?0.75:0.45; tx=Math.sin(z.dir); tz=Math.cos(z.dir);
    }
    const len=Math.hypot(tx,tz)||1;
    const vx=tx/len*speed*dt, vz=tz/len*speed*dt;

    const before=z.pos.x+z.pos.z;
    moveZombie(z,vx,vz);
    const moved=Math.abs(z.pos.x+z.pos.z-before);
    if(z.state==="chase"){
      if(moved<0.004){ z.stuck+=dt; if(z.stuck>0.5){ z.side=Math.random()<0.5?-1:1; z.stuck=0; } }
      else { z.stuck=Math.max(0,z.stuck-dt*0.6); if(z.stuck<=0) z.side=0; }
    }
    if(speed>0.05){
      const want=Math.atan2(tx,tz);
      let diff=want-z.dir;
      while(diff>Math.PI)diff-=Math.PI*2;
      while(diff<-Math.PI)diff+=Math.PI*2;
      z.dir+=diff*Math.min(1,dt*(zombieAlert(z)?ALERT_TURN:3.0));
    }
    z.g.position.set(z.pos.x,z.y,z.pos.z);
    z.g.rotation.y=z.dir;

    // アニメーション
    if(z.an){ FX.zombieAnim(z,dt); }
    else if(z.model){
      const wantWalk=zombieAlert(z)&&!!z.wAction;
      if(wantWalk!==z.walking){
        z.walking=wantWalk;
        if(wantWalk){
          if(ZMODEL.axes&&ZMODEL.base){      // 手続きで曲げた分を戻す
            for(const k in z.bones) if(z.bones[k]&&ZMODEL.base[k]) z.bones[k].quaternion.copy(ZMODEL.base[k]);
          }
          z.g.rotation.z=0;
        }
      }
      if(sameFloor&&dist<32){
        if(z.walking){
          const d=ZMODEL.walk.duration;
          z.wPhase=(z.wPhase+dt*(z.state==="chase"?1.35:0.75))%d;
          z.wAction.time=z.wPhase; z.wMixer.update(0);
        }else if(z.action){
          const rate=z.state==="chase"?1.25:0.72;
          const span=CLIP.LOOP_B-CLIP.LOOP_A;
          z.phase=(z.phase+dt*rate)%span;
          poseZombie(z,CLIP.LOOP_A+z.phase);
        }else if(z.bones){
          animateModelProc(z);
        }
      }
    }else{
      const w=z.state==="chase"?7.0:3.2, amp=z.state==="chase"?0.62:0.3;
      z.legs[0].rotation.x=Math.sin(z.t*w)*amp;
      z.legs[1].rotation.x=-Math.sin(z.t*w)*amp;
      z.arms[0].rotation.x=-1.35+Math.sin(z.t*w+1)*0.16;
      z.arms[1].rotation.x=-1.35-Math.sin(z.t*w+1)*0.16;
      z.g.rotation.z=Math.sin(z.t*w*0.5)*0.06;
    }

    // 初めてゾンビを目にした瞬間にBGMを開始
    if(!bgmStarted&&sameFloor&&z.down<=0){
      const vis=isPitchDark()?5.5:16;
      if(dist<vis){
        const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw);
        const dot=(-dx*fx-dz*fz)/(dist||1);   // プレイヤー→ゾンビ方向との内積
        if((dot>0.45||dist<3.0)&&losClear(pEye,_tmpB.set(z.pos.x,z.y+1.3,z.pos.z)))
          startBgmNow();
      }
    }
    // 接触ダメージ
    if(sameFloor&&dist<0.68&&!dead&&!cleared) hurt(z);
    // 接近ダメージ演出
    if(sameFloor&&dist<3.4){
      const v=1-(dist-0.68)/2.7;
      dmgEl.style.opacity=Math.min(0.85,Math.max(parseFloat(dmgEl.style.opacity)||0,v*0.8));
      breathe(v);
    }
  }
}

/* ============================================================
   衝突と地面
   ============================================================ */
function overlaps(box,x,z,r,y0,y1){
  return (x+r>box.min.x&&x-r<box.max.x&&z+r>box.min.z&&z-r<box.max.z&&y1>box.min.y&&y0<box.max.y);
}
function blocked(x,z,r,feetY){
  const y0=feetY+0.15,y1=feetY+1.7;
  for(let i=0;i<colliders.length;i++){
    const c=colliders[i];
    if(!c.active)continue;
    if(overlaps(c.box,x,z,r,y0,y1)) return true;
  }
  return false;
}
const ZOMBIE_R=0.55;   // 腕の振り幅まで含めた半径（壁抜け防止）
function moveZombie(z,vx,vz){
  const step=(nx,nz)=>{
    if(nx>13.9&&Math.abs(nz)<3.05) return null;   // エレベーターの中には入れない
    if(z.y>ROOF_Y-1.0&&nx<-13.2) return null;     // 屋上：塔屋の戸口には近づかない
    if(z.y<-2 && nz>3.5) return null;             // 地下：梯子の周辺には近寄らない
    if(Math.abs(z.y)<1 && nz>2.7 && Math.abs(nx)<4.6) return null; // 1F：設備室には入らない
    const g=surfaceAt(nx,nz,z.y);
    if(Math.abs(g-z.y)>0.55) return null;      // 段差が大きすぎる＝進めない
    if(blocked(nx,nz,ZOMBIE_R,g)) return null;
    return g;
  };
  if(vx!==0){ const g=step(z.pos.x+vx,z.pos.z); if(g!==null){ z.pos.x+=vx; z.y=g; } }
  if(vz!==0){ const g=step(z.pos.x,z.pos.z+vz); if(g!==null){ z.pos.z+=vz; z.y=g; } }
}
function moveEntity(pos,vx,vz,r,feetY){
  if(vx!==0&&!blocked(pos.x+vx,pos.z,r,feetY)) pos.x+=vx;
  if(vz!==0&&!blocked(pos.x,pos.z+vz,r,feetY)) pos.z+=vz;
}
// 階段下の空洞など、本来立てない場所に落ちてしまった場合の復帰処理
function rescueIfFallen(){
  const x=player.pos.x, z=player.pos.z;
  if(x>=-17||x<=-22.8||z<=-3||z>=3) return;
  let low=Infinity;
  for(const L of [4,8,12]){ const v=stairSurface(x,z,L); if(v!==null) low=Math.min(low,v); }
  if(low===Infinity) return;
  if(player.pos.y<low-0.45){
    player.pos.set(-15.5,0,0); player.vy=0; shake=1.0;
    say("足を踏み外した。\n1階の踊り場まで転がり落ちた。",4.0);
  }
}
function surfaceAt(x,z,feetY){
  const c=[];
  if(x>14&&x<20.1&&z>-3&&z<3){ c.push(elev.y); }
  else if(x<-14&&x>-22.8&&z>-3&&z<3){
    for(const L of [0,4,8,12]){ const s=stairSurface(x,z,L); if(s!==null)c.push(s); }
    c.push(0);
  }
  else if(z<-9.2||z>9.2||x>14.2||x<-14.2){ c.push(0); }
  else { c.push(0,4,8,12); }
  if(inBasement(x,z)) c.push(BASE_Y);
  let best=-999;
  for(const v of c) if(v<=feetY+0.62&&v>best) best=v;
  if(best===-999){ best=Math.min.apply(null,c); }
  return best;
}

/* ============================================================
   プレイヤー
   ============================================================ */
function updatePlayer(dt){
  const fwd=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
  const rgt=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  let mx=0,mz=0;
  if(keysHeld["KeyW"]||keysHeld["ArrowUp"]){mx+=fwd.x;mz+=fwd.z;}
  if(keysHeld["KeyS"]||keysHeld["ArrowDown"]){mx-=fwd.x;mz-=fwd.z;}
  if(keysHeld["KeyD"]||keysHeld["ArrowRight"]){mx+=rgt.x;mz+=rgt.z;}
  if(keysHeld["KeyA"]||keysHeld["ArrowLeft"]){mx-=rgt.x;mz-=rgt.z;}
  const len=Math.hypot(mx,mz);
  const wantRun=(keysHeld["ShiftLeft"]||keysHeld["ShiftRight"])&&player.stam>1&&len>0;
  const sp=wantRun?RUN:WALK;
  if(wantRun) player.stam=Math.max(0,player.stam-dt*24);
  else player.stam=Math.min(100,player.stam+dt*15);
  stamFill.style.width=player.stam+"%";
  stamFill.style.background=player.stam<25?"#a3271f":"#8b8578";

  if(len>0){
    mx/=len;mz/=len;
    moveEntity(player.pos,mx*sp*dt,mz*sp*dt,PLAYER_R,player.pos.y);
    player.bob+=dt*(wantRun?13:8.5);
    if(!player.riding) footstep(dt,wantRun);
  }

  // 高さ
  const inCar = player.pos.x>14.3 && player.pos.x<19.9 && Math.abs(player.pos.z)<2.9;
  player.riding=inCar;
  if(inCar){
    player.pos.y=elev.y; player.vy=0;
  }else{
    const g=surfaceAt(player.pos.x,player.pos.z,player.pos.y);
    if(player.pos.y>g+0.04){
      player.vy-=15*dt; player.pos.y+=player.vy*dt;
      if(player.pos.y<g){player.pos.y=g;player.vy=0;}
    }else{ player.pos.y=g; player.vy=0; }
    rescueIfFallen();
  }

  if(invuln>0) invuln-=dt;
  if(muzzleT>0){ muzzleT-=dt; muzzle.intensity=muzzleT>0?3.4:0; }
  if(recoil>0){
    recoil=Math.max(0,recoil-dt*5.0);
    viewGun.position.set(0.20,-0.19+recoil*0.02,-0.31+recoil*0.085);
    viewGun.rotation.x=0.06+recoil*0.22;
  }
  let sx=0,sy=0;
  if(shake>0){
    shake=Math.max(0,shake-dt*2.0);
    sx=(Math.random()-0.5)*shake*0.16; sy=(Math.random()-0.5)*shake*0.16;
  }
  const bobY=Math.sin(player.bob)*0.035*(len>0?1:0);
  camera.position.set(player.pos.x+sx,player.pos.y+EYE+bobY+sy,player.pos.z);
  camera.rotation.set(player.pitch,player.yaw,0,"YXZ");

  // フロア表示
  const fi=player.pos.y<-2?-1:Math.max(0,Math.min(3,Math.round(player.pos.y/FH)));
  floorLabel.textContent=(fi<0)?"B1":FLOOR_NAME[fi];
  if(fi!==lastFloor){ lastFloor=fi; onFloorEnter(fi); }
  // 屋上の扉の貼り紙（鍵を持っていない時だけ）
  const nearNote = !!roofNote && Math.abs(player.pos.y-ROOF_Y)<2.0 &&
    Math.hypot(player.pos.x+14,player.pos.z)<2.7 && !inventory.kroof;
  if(nearNote && !wasNearNote && !choiceOpen){
    openChoice("貼り紙がある。読みますか？","読む","読まない",
      ()=>say("「屋上は封鎖する。鍵は地下室に置いた」"),null,"note");
  }
  if(!nearNote && choiceOpen && choiceCtx && choiceCtx.tag==="note") closeChoice();
  wasNearNote=nearNote;
  // 設備室（梯子のある部屋）に入るたび、予備弾倉が未回収なら知らせる
  const inLadderRoom = Math.abs(player.pos.y)<1.0 &&
    player.pos.x>-4.1 && player.pos.x<4.1 && player.pos.z>2.6 && player.pos.z<9.0;
  if(inLadderRoom && !wasInLadderRoom && !flags.magTaken)
    say("3Fに予備弾倉がある。まだ取ってなかったな…");
  wasInLadderRoom=inLadderRoom;
  // 1Fの案内は、かごを降りてフロアに立ってから
  if(!flags.phoneHinted && !flags.called && !cleared &&
     Math.abs(player.pos.y)<0.6 && !player.riding && player.pos.x<13.6){
    flags.phoneHinted=true;
    say("電話がある。救助を呼ぼう。");
  }
  // ヘリのはしご
  ladderNear = flags.called && !ending.active && !cleared &&
    rescueGroup && rescueGroup.visible && player.pos.y>ROOF_Y-1.0 &&
    (ladderTip(_tip), Math.hypot(player.pos.x-_tip.x,player.pos.z-_tip.z)<2.2 &&
     _tip.y<player.pos.y+2.6);
  // 屋上のガイドは、扉を抜けて実際に屋上の床へ出てから
  const onRoofSlab = player.pos.y>ROOF_Y-0.6 && player.pos.x>-13.8;
  if(onRoofSlab && !flags.roofArrived){
    flags.roofArrived=true;
    if(!flags.called) say("夜風。街の灯りが、ずいぶん遠い。");
  }
  if(onRoofSlab && flags.called && !flags.roofReady){
    flags.roofReady=true;
    setObjective("ヘリのはしごをつかめ。");
    runScript([
      [0.5,()=>say("ヘリコプターが来ている！")],
      [3.3,()=>showHold("垂らされたはしごをつかめ！")]
    ]);
  }


}

/* ============================================================
   インタラクト
   ============================================================ */
let current=null;
function updateInteract(){
  current=null;
  if(ladderNear){
    promptEl.innerHTML='<span>E</span>はしごを掴む';
    promptEl.style.opacity=1;
    current={it:{use:startRescue},txt:"はしごを掴む"};
    return;
  }
  let bestD=1e9;
  const fwd=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
  for(const it of interacts){
    const dx=it.pos.x-player.pos.x, dz=it.pos.z-player.pos.z, dy=it.pos.y-player.pos.y;
    if(Math.abs(dy)>2.2)continue;
    const d=Math.hypot(dx,dz);
    if(d>it.r)continue;
    const dot=(dx*fwd.x+dz*fwd.z)/(d||1);
    if(d>0.7&&dot<0.35)continue;
    const txt=it.label(); if(!txt)continue;
    if(d<bestD){bestD=d;current={it,txt};}
  }
  if(current){ promptEl.innerHTML='<span>E</span>'+current.txt; promptEl.style.opacity=1; }
  else promptEl.style.opacity=0;
}

/* ============================================================
   進行フラグ
   ============================================================ */
function onDoorOpened(d){
  if(d.keyId==="kstair"){ setObjective("非常階段を降りて2Fへ。"); }
}
function setObjective(t){ objText.textContent=t; }
function rebuildHpBar(){
  hpBar.innerHTML="";
  for(let i=0;i<HP_MAX;i++) hpBar.appendChild(document.createElement("i"));
}
function refreshHp(){
  const bars=hpBar.children;
  for(let i=0;i<bars.length;i++) bars[i].className = (i<hp)?"":"gone";
  statusEl.className = (hp<=1)?"low":"";
  lowEl.style.display = (hp===1&&!dead&&!cleared)?"block":"none";
}
function hurt(z){
  if(invuln>0||dead||cleared) return;
  hp--; invuln=2.1; z.stagger=2.0; shake=1.0;
  refreshHp(); sfx("hit");
  dmgEl.style.opacity="1"; FX.hurt();
  const dx=player.pos.x-z.pos.x, dz=player.pos.z-z.pos.z, l=Math.hypot(dx,dz)||1;
  const kx=dx/l*1.15/10, kz=dz/l*1.15/10;
  for(let i=0;i<10;i++) moveEntity(player.pos,kx,kz,PLAYER_R,player.pos.y); // 分割して壁抜けを防ぐ
  if(hp<=0){ gameOver(); return; }
  say(hp===1?"腕をつかまれた。\n次はない。":"つかまれた。振りほどいて距離を取れ。",3.0);
}
let lastFloor=2;
function onFloorEnter(fi){
  // 通報後に3Fへ戻ると、廊下に新たな個体が現れている
  if(fi===2&&flags.called&&!flags.reinforced){
    flags.reinforced=true;
    for(const sp of [[-9.5,1.4],[-3.5,-1.4],[3.5,1.4],[9.5,-1.4]]) makeZombie(sp[0],8,sp[1]);
    if(!flags.magTaken) runScript([[1.0,()=>say("どこかに予備弾倉があるはずだ。")]]);
  }
  if(fi===1&&!inventory.k2a&&!flags.power) setObjective("2Fを探索し、倉庫2Aの鍵を見つけろ。");
  if(fi===0&&!cleared&&!flags.called) setObjective("1階を調べろ。");
}
const climb={active:false,t:0,dur:1.8,fx:0,fy:0,fz:0,tx:0,ty:0,tz:0};
function startClimb(tx,ty,tz,down){
  climb.active=true; climb.t=0;
  if(ty<-2) flashOn=true;                       // 地下へ降りるときは自動で点灯
  climb.fx=player.pos.x; climb.fy=player.pos.y; climb.fz=player.pos.z;
  climb.tx=tx; climb.ty=ty; climb.tz=tz;
  promptEl.style.opacity=0;
  say(down?"梯子を降りていく。":"梯子を昇っていく。",2.5);
  sfx("step");
}
function updateClimb(dt){
  climb.t+=dt;
  const k=Math.min(1,climb.t/climb.dur), e=k*k*(3-2*k);
  player.pos.set(climb.fx+(climb.tx-climb.fx)*e,
                 climb.fy+(climb.ty-climb.fy)*e,
                 climb.fz+(climb.tz-climb.fz)*e);
  player.vy=0;
  if(Math.floor(climb.t*4)!==Math.floor((climb.t-dt)*4)) sfx("step");
  camera.position.set(player.pos.x,player.pos.y+EYE,player.pos.z);
  camera.rotation.set(player.pitch,player.yaw,0,"YXZ");
  if(k>=1){
    climb.active=false;
    if(climb.ty<-2) flashOn=true;
  }
}
const _tip=new THREE.Vector3(), _camT=new THREE.Vector3();
function startRescue(){
  ending.active=true; ending.phase="grab"; ending.t=0;
  ending.fx=player.pos.x; ending.fy=player.pos.y; ending.fz=player.pos.z;
  promptEl.style.opacity=0; choiceOpen=false; choiceEl.style.display="none"; clearHold();
  sfx("whoosh");
  if(viewGun) viewGun.visible=false;      // 一人称の銃は伏せる
  say("はしごをつかんだ！");
  setObjective("救助完了。");
}
function updateEnding(dt){
  ending.t+=dt;
  if(ending.phase==="grab"){
    // はしごにぶら下がるまでは一人称のまま
    const k=Math.min(1,ending.t/1.5), e=k*k*(3-2*k);
    ladderTip(_tip);
    player.pos.set(ending.fx+(_tip.x-ending.fx)*e,
                   ending.fy+(_tip.y-ending.fy)*e,
                   ending.fz+(_tip.z-ending.fz)*e);
    player.pitch+=(0.10-player.pitch)*Math.min(1,dt*2.0);
    camera.position.set(player.pos.x,player.pos.y+EYE*0.4,player.pos.z);
    camera.rotation.set(player.pitch,player.yaw,0,"YXZ");
    if(k>=1){
      ending.phase="lift"; ending.t=0;
      if(survivor) survivor.visible=true;   // 三人称に切り替わる瞬間に出す
    }
    return;
  }
  // 三人称。旋回しながら上昇していくヘリを追う
  heliAng+=dt*HELI.SPD*0.8;
  const cl=Math.pow(Math.min(1,ending.t/8.0),1.35)*58;
  const rad=HELI.R+Math.min(ending.t,10)*1.1;
  heliPos.set(Math.cos(heliAng)*rad, HELI.H+cl, Math.sin(heliAng)*rad);
  heliGroup.position.copy(heliPos);
  heliGroup.rotation.y=-heliAng;
  ladderTip(_tip);
  player.pos.copy(_tip);
  const back=6.5+Math.min(ending.t,10)*1.3, up=5.0+Math.min(ending.t,10)*1.6;
  _camT.set(heliPos.x-Math.cos(heliAng)*back*0.55+Math.sin(heliAng)*back*0.85,
            heliPos.y+up,
            heliPos.z-Math.sin(heliAng)*back*0.55-Math.cos(heliAng)*back*0.85);
  camera.position.lerp(_camT,Math.min(1,dt*2.2));
  camera.lookAt(heliPos.x,heliPos.y-2.0,heliPos.z);
  if(ending.t>8.6&&!cleared) gameClear();
}
function refreshAmmo(){
  ammoEl.style.display=hasGun?"block":"none";
  if(DF.infinite){ ammoText.textContent="∞"; ammoEl.className=""; return; }
  let t=""; for(let i=0;i<AMMO_MAX;i++) t+= i<ammo?"|":"·";
  ammoText.textContent=t;
  ammoEl.className = ammo<=0?"empty":"";
}
function shoot(){
  if(!hasGun||dead||cleared) return;
  if(!DF.infinite&&ammo<=0){ sfx("click"); say("弾がない。"); return; }
  if(!DF.infinite) ammo--;
  refreshAmmo(); playGunShot();
  FX.fired(false);
  muzzleT=0.07; recoil=1.0; shake=Math.max(shake,0.35);
  const cp=camera.position;
  const org=new THREE.Vector3(cp.x,cp.y,cp.z);
  const cpi=Math.cos(player.pitch);
  const dir=new THREE.Vector3(-Math.sin(player.yaw)*cpi,Math.sin(player.pitch),-Math.cos(player.yaw)*cpi);
  let best=null,bestT=1e9;
  for(const z of zombies){
    if(z.down>0) continue;
    const cx=z.pos.x, cy=z.y+1.15, cz=z.pos.z;
    const vx=cx-org.x, vy=cy-org.y, vz=cz-org.z;
    const t=vx*dir.x+vy*dir.y+vz*dir.z;
    if(t<0.4||t>34||t>=bestT) continue;
    const dh=Math.hypot(org.x+dir.x*t-cx,org.z+dir.z*t-cz);
    const dv=org.y+dir.y*t-cy;
    if(dh>0.55||dv<-0.95||dv>0.80) continue;   // 胴〜頭のあたり判定（やや広め）
    if(!losClear(org,new THREE.Vector3(cx,cy,cz))) continue;
    best=z; bestT=t;
  }
  FX.shot(org,[dir],best?bestT:34,false);
  if(best) FX.hitConfirm(false,null,best);
  player.pitch=Math.min(1.45,player.pitch+0.055);   // 反動は判定後に適用
  if(best){
    best.down=8.5+Math.random()*2.5; best.downTotal=best.down;
    best.state="idle"; best.seen=false;
    best.lose=0; best.stagger=0; best.calm=0;
    sfx("zdown");
    if(!flags.downHinted){ flags.downHinted=true; say("倒れた。だが、動かなくなったわけではない。"); }
  }
}
function applyMode(){
  DF=DIFF[mode]||DIFF.normal;
  HP_MAX=DF.hp; AMMO_MAX=DF.ammo; hp=HP_MAX;
  rebuildHpBar(); refreshHp();
  if(DF.lightsOn){                       // 3Fの照明を最初から点ける
    flags.power3f=true; flashOn=false;
    for(const c of ceilLamps){ if(c.y===8) c.lamp.material=MAT.lampOn; }
  }
  if(DF.startGun){                       // 拳銃を最初から所持
    hasGun=true; ammo=AMMO_MAX;
    inventory.gun="拳銃";
    if(viewGun) viewGun.visible=true;
    if(gunPickup) gunPickup.hidden=true;
    if(gunPickupMesh) gunPickupMesh.visible=false;
  }else if(gunPickup){                    // まだ拾われていなければ床に戻す
    hasGun=false; ammo=0;
    delete inventory.gun;
    if(viewGun) viewGun.visible=false;
    gunPickup.hidden=false;
    if(gunPickupMesh) gunPickupMesh.visible=true;
  }else{
    ammo=Math.min(ammo,AMMO_MAX);
  }
  refreshInv(); refreshAmmo();
}
function refreshInv(){
  const ids=Object.keys(inventory);
  if(ids.length===0){ invList.className="none"; invList.textContent="なし"; return; }
  invList.className="";
  invList.innerHTML=ids.map(id=>{
    const c=invColor[id];
    const mark=c?'<span style="color:'+c+';text-shadow:0 0 6px '+c+'">■</span> '
               :'<span style="color:#8b8578">■</span> ';
    return mark+inventory[id];
  }).join("<br>");
}

/* ============================================================
   演出・UI
   ============================================================ */
let bgmTarget=0.38;
function fadeBgm(to,sec){ bgmTarget=to; }
let curBgm=null;
const BGM_TRACKS=()=>[bgm1,bgm].filter(Boolean);
function hardStopTrack(t){
  // フレーム処理（rAF）に依存しない確実な停止。
  // iOS の WKWebView はバックグラウンド遷移や電力状態で rAF が間引かれることがあり、
  // updateBgm() の音量フェード→閾値到達での pause() だけに頼ると、
  // 前の曲が止まりきらないまま新しい曲が鳴り出し「2曲同時に鳴る」状態になり得る。
  // そのため setTimeout で必ず一定時間後に無音化＋停止させる保険を掛ける。
  try{ t.volume=0.0; t.pause(); }catch(e){}
}
function playTrack(t){
  if(!t||curBgm===t) return;       // 同じ曲への再切り替えは無視（多重発火の防止）
  const prev=curBgm;
  curBgm=t; t.volume=0.0;
  const p=t.play(); if(p&&p.catch) p.catch(()=>{});
  if(prev&&prev!==t){
    // 前の曲は即座に大きく音量を落としておく（rAFのフェードを待たない）。
    // 完全な無音化と pause() は、自然なフェードで消えるならそちらに任せつつ、
    // rAF が間引かれて updateBgm() が呼ばれない状況に備えて 600ms 後に無条件で止める。
    prev.volume = Math.min(prev.volume, 0.12);
    const target=prev;
    setTimeout(()=>{ if(curBgm!==target) hardStopTrack(target); },600);
  }
}
function startBgmNow(){            // 最初のゾンビ目撃：探索曲
  if(bgmStarted) return;
  bgmStarted=true; playTrack(bgm1);
}
function switchToCallBgm(){        // 通報：緊迫曲へ切り替え
  bgmStarted=true; playTrack(bgm);
}
function updateBgm(dt,chased){
  if(!bgmStarted) return;
  let want = (dead||cleared) ? 0 : (chased?0.55:bgmTarget);
  if(heliAudio&&heliSndOn&&heliAudio.volume>0.3) want*=0.55;
  for(const t of BGM_TRACKS()){
    const tgt = (t===curBgm)?want:0;
    const sp  = (t===curBgm)?((dead||cleared)?1.2:0.6):1.4;
    t.volume = Math.max(0,Math.min(1,t.volume+(tgt-t.volume)*Math.min(1,dt*sp)));
    if(t!==curBgm && t.volume<0.02 && !t.paused) t.pause();
  }
}
let msgTimer=0;
function showHold(t){ holdEl.textContent=t; holdEl.style.display="block"; }
function clearHold(){ holdEl.style.display="none"; }
function say(t,dur){
  msgEl.textContent=t; msgEl.style.opacity=1;
  msgTimer=Math.max(dur||5.0,5.0);   // 表示は最低5秒
}
function gameOver(){
  if(dead)return; dead=true; lowEl.style.display="none";
  sfx("scream");
  document.exitPointerLock&&document.exitPointerLock();
  flashEl.style.transition="none"; flashEl.style.opacity="0.85";
  setTimeout(()=>{flashEl.style.transition="opacity 1.4s";flashEl.style.opacity="0";},60);
  overEl.style.display="flex";
}
function gameClear(){
  if(cleared)return; cleared=true; lowEl.style.display="none";
  document.exitPointerLock&&document.exitPointerLock();
  const m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
  clearText.innerHTML="眼下で、ビルがゆっくりと遠ざかっていく。<br>夜風が、まだ震えている手を叩いた。<br><br>脱出タイム　"+
    String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
  clearEl.style.display="flex";
}

/* ============================================================
   サウンド（WebAudio・素材なし）
   ============================================================ */
let AC=null,masterGain=null,droneOsc=null;
function initAudio(){
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    masterGain=AC.createGain(); masterGain.gain.value=FX.volume(); masterGain.connect(AC.destination);
    // 低い持続音
    const o=AC.createOscillator(), g=AC.createGain();
    o.type="sine"; o.frequency.value=42;
    g.gain.value=0.022; o.connect(g); g.connect(masterGain); o.start();
    droneOsc=o;
  }catch(e){ AC=null; }
}
function tone(type,f0,f1,dur,vol,delay){
  if(!AC)return;
  const t=AC.currentTime+(delay||0);
  const o=AC.createOscillator(),g=AC.createGain();
  o.type=type; o.frequency.setValueAtTime(f0,t);
  if(f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(vol,t+0.012);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t+dur+0.05);
}
function noiseBurst(dur,vol,f){
  if(!AC)return;
  const n=AC.sampleRate*dur|0;
  const b=AC.createBuffer(1,n,AC.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2);
  const src=AC.createBufferSource(); src.buffer=b;
  const bp=AC.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=f||800; bp.Q.value=1.1;
  const g=AC.createGain(); g.gain.value=vol;
  src.connect(bp); bp.connect(g); g.connect(masterGain); src.start();
}
let gunPool=[],gunIdx=0,gunBuf=null;
function initGunAudio(){
  const el=document.getElementById("sfxgun");
  if(!el) return;
  el.volume=0.8; gunPool=[el];
  for(let i=0;i<3;i++){ const c=el.cloneNode(true); c.volume=0.8; gunPool.push(c); }
  // WebAudioへデコードしておく（<audio>のplay()は数十msの遅延が出るため）
  if(AC){
    try{
      const ab=window.ASSETS&&ASSETS.gunshot;
      if(ab) AC.decodeAudioData(ab.slice(0),(b)=>{ gunBuf=b; },()=>{});
    }catch(e){}
  }
}
function playGunShot(){
  if(gunBuf&&AC&&masterGain){
    try{
      const s=AC.createBufferSource(); s.buffer=gunBuf;
      const g=AC.createGain(); g.gain.value=0.9;
      s.connect(g); g.connect(masterGain); s.start();
      return;
    }catch(e){}
  }
  if(!gunPool.length){ sfx("shot"); return; }
  const a=gunPool[gunIdx++%gunPool.length];
  try{ a.currentTime=0; const p=a.play(); if(p&&p.catch) p.catch(()=>{}); }
  catch(e){ sfx("shot"); }
}
function sfx(kind){
  if(!AC)return;
  switch(kind){
    case "pickup": tone("triangle",880,1500,0.16,0.12); tone("triangle",1320,1700,0.12,0.07,0.06); break;
    case "unlock": tone("square",300,180,0.09,0.09); tone("square",420,240,0.09,0.08,0.11); break;
    case "locked": tone("square",150,110,0.07,0.10); tone("square",140,100,0.07,0.09,0.1); break;
    case "door":   noiseBurst(0.5,0.10,420); tone("sine",120,70,0.5,0.05); break;
    case "bell":   tone("sine",1050,1050,0.5,0.10); tone("sine",1400,1400,0.4,0.06,0.05); break;
    case "groan":  tone("sawtooth",95,58,0.9,0.10); tone("sawtooth",71,44,1.2,0.07,0.15); break;
    case "power":  tone("sawtooth",60,240,0.8,0.10); noiseBurst(0.6,0.08,1600); break;
    case "scream": tone("sawtooth",700,120,1.3,0.22); noiseBurst(1.0,0.20,900); break;
    case "step":   noiseBurst(0.07,0.045,260); break;
    case "hit":    tone("sawtooth",320,60,0.45,0.18); noiseBurst(0.35,0.16,700); break;
    case "shot":   noiseBurst(0.22,0.30,1900); tone("square",180,45,0.20,0.22);
                   noiseBurst(0.6,0.06,320); break;
    case "click":  tone("square",900,700,0.03,0.07); break;
    case "dial":   tone("sine",400,400,0.9,0.07); tone("sine",440,440,0.9,0.05); break;
    case "pick":   tone("square",620,520,0.06,0.09); break;
    case "whoosh": noiseBurst(1.0,0.10,300); break;
    case "land":   noiseBurst(0.7,0.16,180); tone("sine",90,45,0.8,0.12); break;
    case "zdown":  tone("sawtooth",130,40,0.7,0.13); noiseBurst(0.4,0.09,420); break;
  }
}
let stepT=0;
function footstep(dt,run){
  stepT-=dt*(run?2.1:1.35);
  if(stepT<=0){ stepT=1; sfx("step"); }
}
let breathT=0;
function breathe(v){
  if(!AC)return;
  breathT-=0.016;
  if(breathT<=0){ breathT=0.75-v*0.3; tone("sine",70,52,0.28,0.05*v); }
}

/* ============================================================
   ユーティリティ
   ============================================================ */
function mulberry(a){
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

/* ============================================================
   DOM参照
   ============================================================ */
const promptEl=document.getElementById("prompt");
const msgEl=document.getElementById("msg");
const objText=document.getElementById("objtext");
const invList=document.getElementById("invlist");
const floorLabel=document.getElementById("floorlabel");
const timeLabel=document.getElementById("timelabel");
const stamFill=document.getElementById("stamfill");
const elevPanel=document.getElementById("elev");
const overEl=document.getElementById("over");
const clearEl=document.getElementById("clear");
const clearText=document.getElementById("cleartext");
const flashEl=document.getElementById("flash");
const dmgEl=document.getElementById("dmg");
const titleEl=document.getElementById("title");
const hpBar=document.getElementById("hpbar");
const ammoEl=document.getElementById("ammo");
const ammoText=document.getElementById("ammotext");
const statusEl=document.getElementById("status");
const bgm=document.getElementById("bgm");
const bgm1=document.getElementById("bgm1");
const heliAudio=document.getElementById("heli");
const choiceEl=document.getElementById("choice");
const holdEl=document.getElementById("hold");
const lowEl=document.getElementById("lowhp");
const choiceText=document.getElementById("choicetext");
const cb1El=document.getElementById("cb1");
const cb2El=document.getElementById("cb2");

/* ============================================================
   初期化
   ============================================================ */
function init(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x04060a);
  scene.fog=new THREE.FogExp2(0x04060a,0.057);

  camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,0.05,120);
  camera.rotation.order="YXZ";
  scene.add(camera);

  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(FX.pixelRatio());
  renderer.setSize(innerWidth,innerHeight);
  renderer.outputEncoding=THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);
  FX.initRenderer();

  initTex(); FX.textures(TEX,makeTex); initMat(); FX.materials(MAT,TEX);

  AMB=new THREE.AmbientLight(0x232b3a,0.34); scene.add(AMB);
  HEM=new THREE.HemisphereLight(0x2c364c,0x07090d,0.24); scene.add(HEM);

  // 懐中電灯
  const fl=new THREE.SpotLight(0xfff0cd,2.35,29,Math.PI/6.4,0.56,1.15);
  fl.position.set(0.18,-0.12,0);
  const tgt=new THREE.Object3D(); tgt.position.set(0,0,-12); camera.add(tgt);
  fl.target=tgt; camera.add(fl);
  window.flashlight=fl; flashTarget=tgt;
  const near=new THREE.PointLight(0xffe8c4,0.32,3.4); camera.add(near); nearLight=near;
  // 手元の銃（取得後に表示）
  viewGun=makeGunMesh(1.0);
  viewGun.position.set(0.20,-0.19,-0.31);
  viewGun.rotation.set(0.04,0.08,0);
  viewGun.visible=false; camera.add(viewGun);
  muzzle=new THREE.PointLight(0xffd9a0,0,7); muzzle.position.set(0.20,-0.14,-0.72);
  camera.add(muzzle);

  for(let i=0;i<3;i++) buildFloor(i);
  buildRoof();
  buildStairs();
  buildPhone();
  buildRescue();
  buildElevator();

  /* --- 施錠されたドア（非常階段） --- */
  // 3F：施錠（非常階段の鍵が必要）
  makeDoor({x:-14,y:8,z:0,axis:"z",width:1.5,hingeSign:1,locked:true,keyId:"kstair",
    name:"非常階段のドア",sign:"EXIT",color:KEYCOL.kstair,faceSign:1});
  // 2F：開錠
  makeDoor({x:-14,y:4,z:0,axis:"z",width:1.5,hingeSign:1,locked:false,
    name:"非常階段のドア",sign:"EXIT",color:KEYCOL.kstair,faceSign:1});
  // 1F：施錠（開かない）
  const d1=makeDoor({x:-14,y:0,z:0,axis:"z",width:1.5,hingeSign:1,locked:true,keyId:"__never__",
    name:"非常階段のドア",sign:"EXIT",color:KEYCOL.kstair,faceSign:1});
  d1.name="非常階段のドア（1F）";

  makeDoor({x:-14,y:ROOF_Y,z:0,axis:"z",width:1.5,hingeSign:1,locked:true,keyId:"kroof",
    name:"屋上のドア",sign:"ROOF",color:KEYCOL.kroof,faceSign:-1});
  // 貼り紙
  const noteTex=makeTex((g,sz)=>{
    g.fillStyle="#efece2"; g.fillRect(0,0,sz,sz);
    g.strokeStyle="#c9c4b6"; g.lineWidth=2; g.strokeRect(3,3,sz-6,sz-6);
    g.fillStyle="#5a5850";
    for(let i=0;i<6;i++) g.fillRect(14,26+i*16,sz-28-(i===5?38:0),5);
  },1,1,64);
  const note=new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.44),
    new THREE.MeshBasicMaterial({map:noteTex}));
  note.position.set(-14.16,ROOF_Y+1.45,-0.1); note.rotation.y=-Math.PI/2; scene.add(note);
  roofNote=note;
  buildSky();

  /* --- 鍵 --- */
  makeKey("k3a","3Aの鍵",-8.0,8,-6.0,"部屋3Aを開け、非常階段の鍵を探せ。");   // 給湯室3Cの中
  makeKey("kstair","非常階段の鍵",-9.5,8,6.4,"非常階段のドアを解錠し、2Fへ降りろ。");
  makeKey("k2a","2Aの鍵",-3.2,4,-7.2,"倉庫2Aを開け、2Bの鍵を探せ。");        // 事務室2Cの中（拳銃とは離す）
  makeKey("k2b","2Bの鍵",-10.4,4,7.1,"機械室2Bでエレベーターの電源を入れろ。");

  makeKey("k3d","3Dの鍵",8.6,4,-6.2,null,"3F 備品庫のものらしい。");
  makeKey("kroof","屋上の鍵",0,BASE_Y,-17.5,null,"3Fの非常階段から、さらに上へ行けるらしい。");

  /* --- 拳銃（2F 事務室）と予備弾倉（3F 備品庫 3D／要 3Dの鍵） --- */
  const gunItem=makeGunMesh(1.35); gunItem.rotation.z=0.35;
  gunPickup=makePickup({mesh:gunItem,x:-8.5,y:4,z:-6.2,label:"拳銃を拾う",lift:0.32,
    onTake:()=>{
      hasGun=true; ammo=AMMO_MAX; viewGun.visible=true;
      inventory.gun="拳銃"; refreshInv(); refreshAmmo(); sfx("pickup");
      say("拳銃を手に入れた。装弾数"+AMMO_MAX+"。\n左クリックで撃てる。");
      gunPickup=null;
    }});
  gunPickupMesh=gunItem;
  makePickup({mesh:makeAmmoMesh(),x:8.0,y:8,z:-6.4,label:"予備弾倉を拾う",lift:0.28,
    onTake:()=>{
      ammo=AMMO_MAX; refreshAmmo(); sfx("pickup"); flags.magTaken=true;
      if(!hasGun){ inventory.mag="予備弾倉"; refreshInv(); say("予備弾倉を手に入れた。\n肝心の銃がない。",4.0); }
      else say(DF.infinite?"弾なら、まだ十分ある。":"弾を装填した。残り"+AMMO_MAX+"発。");
    }});

  /* --- エレベーターの電源盤（2B = 2F 北東の部屋） --- */
  const brd=new THREE.Group(); brd.position.set(7,4+1.35,8.75); scene.add(brd);
  const bb=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.15,0.22),MAT.metal); brd.add(bb);
  const lv=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.42,0.1),MAT.dark);
  lv.position.set(0,-0.2,-0.2); brd.add(lv);
  const led=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8),MAT.lampOff);
  led.position.set(0.45,0.32,-0.14); brd.add(led);
  const plate=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.24),
    new THREE.MeshBasicMaterial({map:label("ELEVATOR","#20242b","#e8a13a",256,68)}));
  plate.position.set(0,0.34,-0.12); plate.rotation.y=Math.PI; brd.add(plate);
  interacts.push({
    pos:new THREE.Vector3(7,4+1.35,8.4), r:2.2,
    label:()=> flags.power?null:"エレベーターの主電源を入れる",
    use:()=>{
      flags.power=true; sfx("power");
      led.material=MAT.emerg; lv.rotation.x=0.9;
      say("重い音を立てて、ビルに電気が戻った。\nエレベーターが動き出す。");
      setObjective("エレベーターで1Fへ降りろ。");
      for(const c of ceilLamps){ if(c.y!==8) c.lamp.material=MAT.lampOn; }
      elevGoTo(1);
    }
  });

  /* --- 3F 会議室の電源装置 --- */
  const b3=new THREE.Group(); b3.position.set(7,8+1.35,8.75); scene.add(b3);
  b3.add(new THREE.Mesh(new THREE.BoxGeometry(1.5,1.15,0.22),MAT.metal));
  const lv3=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.42,0.1),MAT.dark);
  lv3.position.set(0,-0.2,-0.2); b3.add(lv3);
  const led3=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8),MAT.lampOff);
  led3.position.set(0.45,0.32,-0.14); b3.add(led3);
  const pl3=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.24),
    new THREE.MeshBasicMaterial({map:label("3F LIGHTING","#20242b","#e8a13a",256,68)}));
  pl3.position.set(0,0.34,-0.12); pl3.rotation.y=Math.PI; b3.add(pl3);
  interacts.push({
    pos:new THREE.Vector3(7,8+1.35,8.4), r:2.2,
    label:()=> flags.power3f?null:"3Fの照明ブレーカーを入れる",
    use:()=>{
      flags.power3f=true; sfx("power");
      led3.material=MAT.emerg; lv3.rotation.x=0.9;
      for(const c of ceilLamps){ if(c.y===8) c.lamp.material=MAT.lampOn; }
      flashOn=false;
      say("ブレーカーが上がり、3Fに明かりが戻った。\n懐中電灯は消しておこう。");
    }
  });

  /* --- ゾンビ配置（下の階ほど多い） --- */
  makeZombie(-4.0,8,6.3);                // 3F ×1（資料室3Aの中）
  makeZombie(-6.0,4,1.0);                // 2F ×2
  makeZombie(9.0,4,-0.9);
  makeZombie(7.5,0,-3.5);                // 1F ×3
  makeZombie(-2.0,0,-6.0);
  makeZombie(-9.0,0,0.6);
  // 地下の通路 ×4
  for(const bz of [1.5,-3.5,-8.0,-12.5]) makeZombie(0,BASE_Y,bz);
  // 屋上 ×8
  for(const sp of [[-6.0,-5.0],[-5.0,4.5],[0.0,-6.5],[1.0,5.5],
                   [6.0,-3.0],[7.0,3.0],[11.5,-6.0],[12.0,5.0]])
    makeZombie(sp[0],ROOF_Y,sp[1]);

  loadZombieModel(); loadGunModel();
  applyMode();
  setObjective("フロアを探索し、部屋3Aの鍵を見つけろ。");
  const dsel=document.getElementById("diff");
  if(dsel) dsel.addEventListener("click",(e)=>{
    const d=e.target.closest?e.target.closest(".d"):null;
    if(!d) return;
    mode=d.getAttribute("data-m")||"normal";
    for(const c of dsel.children) c.className="d"+(c===d?" sel":"");
    applyMode();
  });
  refreshInv(); refreshHp(); refreshAmmo();

  clock=new THREE.Clock();
  addEventListener("resize",()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
    FX.resize();
  });
  FX.ready();
  animate();
}

/* ============================================================
   入力
   ============================================================ */
addEventListener("keydown",e=>{
  keysHeld[e.code]=true;
  if(!started||dead||cleared)return;
  if(choiceOpen){
    if(e.code==="Digit1"||e.code==="Numpad1"){ answerChoice(true); return; }
    if(e.code==="Digit2"||e.code==="Numpad2"||e.code==="Escape"){ answerChoice(false); return; }
  }
  if(ending.active||climb.active) return;
  if(e.code==="KeyE"&&current){ current.it.use(); }
  if(e.code==="KeyF"){
    if(!lightsOffHere()){ say("照明がついている。\n今は懐中電灯の出番じゃない。"); }
    else { flashOn=!flashOn; sfx("click"); }
  }
  if(player.riding&&elev.state==="open"&&flags.power){
    if(e.code==="Digit1"||e.code==="Numpad1") elevGoTo(0);
    if(e.code==="Digit2"||e.code==="Numpad2") elevGoTo(1);
    if(e.code==="Digit3"||e.code==="Numpad3") elevGoTo(2);
  }
  if(["Space","ArrowUp","ArrowDown","Digit1","Digit2","Digit3"].indexOf(e.code)>=0) e.preventDefault();
});
addEventListener("keyup",e=>{ keysHeld[e.code]=false; });
addEventListener("blur",()=>{ for(const k in keysHeld) keysHeld[k]=false; });
document.addEventListener("pointerlockchange",()=>{
  if(document.pointerLockElement!==renderer.domElement)
    for(const k in keysHeld) keysHeld[k]=false;
});
addEventListener("mousemove",e=>{
  if(document.pointerLockElement!==renderer.domElement)return;
  if(ending.active) return;
  player.yaw-=e.movementX*sens;
  player.pitch-=e.movementY*sens;
  player.pitch=Math.max(-1.45,Math.min(1.45,player.pitch));
});
document.getElementById("sensrange").addEventListener("input",e=>{ sens=e.target.value/1000*0.018; FX.setSens(+e.target.value); });
document.getElementById("startbtn").addEventListener("click",()=>{
  titleEl.style.display="none"; started=true;
  initAudio(); initGunAudio();
  if(bgm) bgm.volume=0.0;    // BGMは最初のゾンビ目撃まで鳴らさない
  if(bgm1) bgm1.volume=0.0;
  renderer.domElement.requestPointerLock();
  say(DF.startGun?"どこかに鍵があるはずだ…":"どこかに鍵と銃があるはずだ…");
});
addEventListener("click",(e)=>{
  if(e.target&&e.target.closest&&e.target.closest("#pause .card")) return;
  if(started&&!dead&&!cleared&&document.pointerLockElement!==renderer.domElement)
    renderer.domElement.requestPointerLock();
});
addEventListener("mousedown",e=>{
  if(!started||dead||cleared||ending.active||climb.active)return;
  if(document.pointerLockElement!==renderer.domElement)return;
  if(e.button===0) shoot();
});
addEventListener("contextmenu",e=>{ if(started) e.preventDefault(); });

/* ============================================================
   メインループ
   ============================================================ */
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(0.05,clock.getDelta());

  if(started&&!dead&&!cleared){
    elapsed+=dt;
    const m=Math.floor(elapsed/60),s=Math.floor(elapsed%60);
    timeLabel.textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    if(ending.active){
      updateEnding(dt);
    }else if(climb.active){
      updateClimb(dt);
    }else{
      updatePlayer(dt);
      updateZombies(dt);
      updateInteract();
    }
    // 非常灯（3Fはブレーカーを入れるまで消灯）
    for(let i=0;i<emergLights.length;i++){
      const dead3f=(emergFloor[i]===2&&!flags.power3f);
      emergLights[i].intensity=dead3f?0
        :0.34+Math.sin(elapsed*3.1+i)*0.10+(Math.random()<0.02?-0.22:0);
    }
    // 懐中電灯（照明が消えている場所でのみ点く／暗闇では足元だけ）
    const dark3f=isPitchDark();
    const canFlash=lightsOffHere();
    window.flashlight.intensity=(flashOn&&canFlash)?2.35:0;
    if(dark3f){
      window.flashlight.angle=Math.PI/7.2; window.flashlight.distance=8.0;
      window.flashlight.penumbra=0.86; flashTarget.position.set(0,-1.15,-2.1);
      nearLight.intensity=0.06;
    }else{
      window.flashlight.angle=Math.PI/6.4; window.flashlight.distance=29;
      window.flashlight.penumbra=0.56; flashTarget.position.set(0,0,-12);
      nearLight.intensity=canFlash?0.32:0.10;
    }
    dmgEl.style.opacity=Math.max(0,(parseFloat(dmgEl.style.opacity)||0)-dt*0.9);
    // 明るさ：3Fの暗闇 / 屋上 / それ以外
    const onRoof = player.pos.y>ROOF_Y-1.0;
    let ambT,hemT,fogT;
    if(dark3f){ ambT=0.014; hemT=0.006; fogT=0.42; }
    else{
      ambT=flags.power?0.82*FX.ambK:0.34; hemT=flags.power?0.55*FX.ambK:0.24;
      fogT=onRoof?0.016:(flags.power?0.040:0.057);
    }
    const lk=Math.min(1,dt*2.4);
    AMB.intensity+=(ambT-AMB.intensity)*lk;
    HEM.intensity+=(hemT-HEM.intensity)*lk;
    scene.fog.density += (fogT-scene.fog.density)*Math.min(1,dt*1.4);
    roofLight.intensity += ((onRoof?0.85:0)-roofLight.intensity)*Math.min(1,dt*1.4);
    skyGroup.position.set(camera.position.x,camera.position.y,camera.position.z);
  }
  updateElev(dt);
  updateHeli(dt);
  updateDoors(dt);
  for(const f of tickers) f(dt);

  // エレベーターの階数選択UI
  const showPanel = started&&!dead&&!cleared&&!ending.active&&player.riding&&elev.state==="open"&&flags.power;
  elevPanel.style.display=showPanel?"block":"none";
  if(showPanel){
    for(let i=0;i<3;i++)
      document.getElementById("eb"+(i+1)).className="b"+(elev.floor===i?" cur":"");
  }
  if(script.length){
    scriptT+=dt;
    while(script.length&&script[0][0]<=scriptT) script.shift()[1]();
  }
  if(rescueGroup&&rescueGroup.visible){
    for(const f of flashers)
      f.m.visible = ((elapsed*1.6+f.ph)%1)<0.5;
  }
  let chased=false;
  for(const z of zombies) if(z.state==="chase"){ chased=true; break; }
  updateBgm(dt,chased);
  if(msgTimer>0){ msgTimer-=dt; if(msgTimer<=0) msgEl.style.opacity=0; }

  FX.frame(dt);
}

init();
