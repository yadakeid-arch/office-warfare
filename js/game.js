"use strict";
/* ============================================================
   OFFICE WARFARE — 3階建てオフィス 4人対戦シューティング
   NIGHT SHIFT のマップをそのまま流用（Three.js r128 / PeerJS）
   フロア : 1F y=0 / 2F y=4 / 3F y=8 / 屋上 y=12 / 地下 y=-4
   ============================================================ */

/* ---------- 定数 ---------- */
const T=0.24, CEIL=3.2, FH=4, EYE=1.62;
const WALK=3.1, RUN=5.0, PLAYER_R=0.30;
const CROUCH_EYE=1.00;        // しゃがんだときの目線の高さ
const CROUCH_SPD=0.5;         // しゃがみ移動は歩きの半分
const CROUCH_CY=0.62;         // しゃがんだときの胴の判定中心
const CROUCH_LO=-0.57, CROUCH_HI=0.43;   // その上下の幅
const FLOOR_NAME=["1F","2F","3F","4F","5F","RF"];
/* 閉鎖の対象になるフロア番号を返す（対象外なら -1）。
   非常階段の中とエレベーターのかごの中は対象外。地下は1F扱い */
function zoneFloorOf(x,y,z){
  if(x<SHAFT_X&&Math.abs(z)<SHAFT_Z) return -1;   // 非常階段
  if(x>13.6&&Math.abs(z)<2.9) return -1;          // エレベーターのかご
  if(y<-2) return 0;                              // 地下
  const f=Math.round(y/FH);
  if(f<0||f>=FLOORS) return -1;                   // 屋上や範囲外
  if(Math.abs(y-f*FH)>2.0) return -1;
  return f;
}
function floorClosed(fi){ return !!closedSet[fi]; }
function closedCount(){ let n=0; for(const k in closedSet) n++; return n; }
/* 最後の1フロアが閉鎖されたら、屋上以外はすべて対象になる（階段もかごも含む） */
function isFinalStage(){ return closedCount()>=FLOORS; }
/* エレベーターのかごの中か */
function inCarZone(x,z){ return x>13.6&&x<19.9&&Math.abs(z)<2.9; }
function inSealedZone(x,y,z){
  if(closedSet[FLOORS]&&inCarZone(x,z)) return true;   // 最後はかごの中だけが封鎖される
  if(isFinalStage()) return y<ROOF_Y-1.0;
  const f=zoneFloorOf(x,y,z);
  return f>=0&&floorClosed(f);
}
function inWarnZone(x,y,z){
  if(warnSet[FLOORS]&&inCarZone(x,z)) return true;     // かごの中にいる者だけに警報
  if(warnSet[FLOORS-1]&&closedCount()>=FLOORS-1) return y<ROOF_Y-1.0;  // 最後の予告は屋上以外すべて
  const f=zoneFloorOf(x,y,z);
  return f>=0&&!!warnSet[f];
}
function floorIndexOf(y){
  if(y<-2) return -1;
  return Math.max(0,Math.min(FLOORS,Math.round(y/FH)));
}
function floorLabelOf(fi){
  if(fi<0) return "地下";
  if(fi>=FLOORS) return "屋上";
  return FLOOR_NAME[fi];
}
const FLOORS=5;                 // 1F..5F
const EV_STOPS=6;               // エレベーターの停止階（1F〜5F＋屋上）
const ROOF_Y=FLOORS*FH;         // 屋上 y=20
const LEVELS=[0,4,8,12,16,20];  // 各フロア＋屋上の床面
const BASE_Y=-4, CEIL_B=2.6;
function inBasement(x,z){
  if(x>=-1.45&&x<=1.45&&z>=-14.2&&z<=8.1) return true;
  if(x>=-4.25&&x<=4.25&&z>=-20.2&&z<=-14)  return true;
  return false;
}
const MAXP=6;                 // 6枠。対戦モードは4人まで、Teamは6人まで
const MAXP_VS=4;
const SLOT_COL =[0x4aa3ff,0xe8503c,0x54c06a,0xe8c23a,0xb06ad8,0x38c8c0];
const SLOT_CSS =["#4aa3ff","#e8503c","#54c06a","#e8c23a","#b06ad8","#38c8c0"];
const SLOT_NAME=["BLUE","RED","GREEN","GOLD","VIOLET","AQUA"];
let LIVES=3;             // モードで変わる（hardは1）
let mode="normal";       // easy / normal / hard / team（対人対戦のみ）
let baseSwitch=null, teamWalls=null, teamPlayers=2;
const DOWN_T=3.0;        // 倒れてからリスポーンまで
const TEAM_DOWN_T=20.0;  // Team: 倒れてから力尽きるまで（仲間の回復薬で復帰できる）
const REVIVE_R=1.6;      // 回復薬を持って近づくと助けられる距離
const PISTOL_BURST=3;    // 連続で撃てる発数
const PISTOL_LOCK=1.5;   // 撃ち切ったあと撃てない時間
const SG_RANGE=10.0;     // ショットガンの有効距離
const SG_COOL=2.5;       // ショットガンの次弾までの待ち時間
const CAMP_T=120;        // 同じフロアに居続けると露見するまでの秒数
const CAMP_REPEAT=60;    // 露見後、居座り続けた場合の再通知の間隔
const LOCK_START=150;    // 最初の予告（秒）。以後30秒ごとに 予告→閉鎖 を繰り返す
const TEAM_LOCK_START=60; // Teamは60秒後に最初の予告
const TEAM_LOCK_GAP=90;   // 以後90秒ごとに1フロアずつ閉鎖（予告はその30秒前）
const LOCK_STEP=30;      // 予告から閉鎖まで、閉鎖から次の予告までの間隔
/* 初期位置とリスポーン先。必ず別フロアに散らす */
const SPAWNS=[
  {x:  0, y:0,      z:-6.5, yaw:Math.PI,    fl:"1F"},
  {x:-10, y:4,      z: 0,   yaw:-Math.PI/2, fl:"2F"},
  {x: 10, y:8,      z: 0,   yaw: Math.PI/2, fl:"3F"},
  {x:-10, y:12,     z: 0,   yaw:-Math.PI/2, fl:"4F"},
  {x: 10, y:16,     z: 0,   yaw: Math.PI/2, fl:"5F"},
  {x:  0, y:ROOF_Y, z: 6.0, yaw:0,          fl:"屋上"},
  {x:  0, y:BASE_Y,  z: 6.6, yaw:Math.PI,   fl:"地下"}    // Team専用（梯子の真下）
];
const SPAWN_MAIN=6;      // 通常モードで使うのは先頭6つ
const SPAWN_BASE=6;      // 地下
/* 敵プレイヤーがいないフロアを選ぶ。
   ・階段の踊り場など中途半端な高さも、最も近いフロアを占有しているとみなす
   ・同時に倒れている相手が復帰予定のフロアも避ける */
function freeSpawnFor(slot){
  if(mode==="team") return teamSpawnIndex(slot);   // 倒れた場所のフロアへ戻る
  const busy={};
  for(let k=0;k<MAXP;k++){
    if(k===slot) continue;
    const p=P[k];
    if(!p.used||!p.alive) continue;
    if(p.down>0&&p.pendSp!=null&&SPAWNS[p.pendSp]) busy[floorIndexOf(SPAWNS[p.pendSp].y)]=1;
    else busy[floorIndexOf(posOf(k).y)]=1;
  }
  const best=[], cand=[], all=[];
  for(let i=0;i<SPAWN_MAIN;i++){
    const fi=Math.round(SPAWNS[i].y/FH);
    if(floorClosed(fi)) continue;                 // 閉鎖済みのフロアには湧かない
    all.push(i);
    const free=!busy[floorIndexOf(SPAWNS[i].y)];
    if(free) cand.push(i);
    if(free&&!warnSet[fi]) best.push(i);          // まもなく閉鎖されるフロアも避ける
  }
  const list=best.length?best:(cand.length?cand:all);
  return list[Math.floor(Math.random()*list.length)];
}

/* ---------- グローバル ---------- */
let scene,camera,renderer,clock,AMB,HEM,viewGun,muzzle,roofLight,skyGroup;
const colliders=[];
const losBlockers=[];
const interacts=[];
const doors=[];
const tickers=[];

let started=false, finished=false, elapsed=0;
let sens=0.0018;

const player={
  pos:new THREE.Vector3(0,0,0), vy:0, yaw:0, pitch:0,
  stam:100, riding:false, bob:0
};
const keysHeld={};
const inventory={};
const invColor={};
const KEYCOL={};
const SHIELD_MAX=3;      // 盾が防げる拳銃の発数（ショットガンは1発で使い切る）
const HEAD_LOW=0.33;     // 胴の判定中心から上、ここより上が頭
const HEAD_R=0.22;       // 頭の半径
function cssHex(c){ return "#"+("000000"+c.toString(16)).slice(-6); }
function dimCol(c,f){
  const r=Math.min(255,((c>>16)&255)*f)|0, g=Math.min(255,((c>>8)&255)*f)|0, b=Math.min(255,(c&255)*f)|0;
  return (r<<16)|(g<<8)|b;
}
/* 電源は最初から入っている（エレベーターは全フロア可・照明はオン） */
const flags={power:true, lightsOn:true};
let flashOn=false, flashTarget=null, nearLight=null;
const emergFloor=[];
let roofNote=null;             // 貼り紙は廃止（makeDoor が参照するので残す）
let muzzleT=0, recoil=0, shake=0, invuln=0;
let lives=LIVES, alive=true;
let weapon=0;            // 0=拳銃 1=ショットガン
let shield=0;            // 盾の残り耐久（0=未所持）
let crouch=false, crouchT=0;
const BLOOM_STEP=0.0157;      // 1発ごとに約0.9度ぶれが増える
const BLOOM_MAX=6;            // 6発で頭打ち（約5.4度）
const BLOOM_COOL=1.0;         // 撃つのを止めてから元に戻るまで（秒）
let bloomN=0, bloomT=0, pistolLock=0;
let hasPot=false;        // Team: 回復薬を持ち運んでいるか
let lockT=0, lockEv=0, lockCheck=0;
const warnSet={};        // 予告中のフロア
/* Team: フロアごとに独立した閉鎖時計。5Fは開始と同時、他は最初に誰かが立ち入ってから */
const TEAM_LOCK_DUR={4:180, 3:90, 2:120, 1:60, 0:180, 5:60};   // 5=屋上（かごが着いてから）
const TEAM_WARN_LEAD=30;
const teamLockT={}, teamWarned={};
const closedSet={};      // 閉鎖済みのフロア番号
let viewShield=null;
let sgCool=0;            // ショットガンのクールダウン残り
let viewSG=null;

/* ガイドテキストはすべて無し */
function say(){}
function setObjective(){}
function onDoorOpened(){}
function showHold(){}
function clearHold(){}

/* 地下だけは常に暗い。それ以外は全館の照明スイッチに従う */
function lightsOffHere(){
  if(player.pos.y<-2) return true;
  return !flags.lightsOn;
}
function isPitchDark(){ return false; }

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
  d.idx=doors.length; doors.push(d);

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
      act({t:"door",i:d.idx});
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

/* ============================================================
   鍵（先に拾った1人だけが持てる。取得はホストが裁定）
   ============================================================ */
const keyReg={};      // id -> {g, it, name, col}
const keyOwner={};    // id -> slot
/* 盾。プレイヤー(1.8m)の7割ほどを覆う大きさ */
function makeShieldMesh(s){
  s=s||1;
  const g=new THREE.Group();
  const W=0.62*s, H=1.26*s;
  const rim=new THREE.Mesh(new THREE.BoxGeometry(W+0.06*s,H+0.06*s,0.025*s),MAT.dark);
  rim.position.z=-0.018*s; g.add(rim);
  const body=new THREE.Mesh(new THREE.BoxGeometry(W,H,0.05*s),MAT.metal);
  g.add(body);
  const win=new THREE.Mesh(new THREE.BoxGeometry(W*0.60,H*0.16,0.056*s),
    new THREE.MeshLambertMaterial({color:0x2b3c48,transparent:true,opacity:0.6}));
  win.position.set(0,H*0.29,0.002*s); g.add(win);
  for(const k of [-0.30,0.00]){
    const rib=new THREE.Mesh(new THREE.BoxGeometry(W*0.92,0.032*s,0.02*s),MAT.dark);
    rib.position.set(0,k*H,0.036*s); g.add(rib);
  }
  return g;
}
/* 回復薬 */
function makePotionMesh(s){
  s=s||1;
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.075*s,0.075*s,0.20*s,10),
    new THREE.MeshLambertMaterial({color:0xd8402f,emissive:0x480f0a}));
  g.add(body);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.032*s,0.032*s,0.07*s,8),MAT.metal);
  neck.position.y=0.13*s; g.add(neck);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(0.078*s,0.038*s,0.078*s),MAT.dark);
  cap.position.y=0.176*s; g.add(cap);
  for(const r of [0,Math.PI/2]){
    const bar=new THREE.Mesh(new THREE.BoxGeometry(0.095*s,0.026*s,0.006*s),
      new THREE.MeshBasicMaterial({color:0xf2f2f2}));
    bar.position.z=0.077*s; bar.rotation.z=r; g.add(bar);
  }
  return g;
}
/* 盾の所持状態 */
function setShield(n){
  shield=n;
  if(viewShield) viewShield.visible=(n>0)&&alive&&started&&!down.active;
}
function applyBlk(m){
  const p=P[m.slot]; if(!p) return;
  const before=p.sh||0;
  p.sh=m.sh;
  sfx(m.sh>0?"clang":"break");
  if(m.slot===net.mySlot){
    setShield(m.sh);
    shake=Math.max(shake,0.5);
    guide(m.sh>0?("盾が受け止めた（残り"+m.sh+"）"):"盾が壊れた",3);
  }
  refreshHud();
}
function applyHeal(m){
  const p=P[m.slot]; if(!p) return;
  p.lives=m.lives;
  if(m.slot===net.mySlot){
    lives=m.lives; sfx("pickup");
    guide("ライフが1回復した",3);
  }
  refreshHud();
}
/* 各フロアの部屋に盾と回復薬をひとつずつ置く */
function placeItems(list){
  for(const it of list){
    if(keyReg[it.id]) continue;
    if(it.k==="sh"){
      makeItem(it.id,makeShieldMesh(0.55),it.x,it.y,it.z,"盾を拾う",
        (slot)=>{
          P[slot].sh=SHIELD_MAX;
          if(slot===net.mySlot){
            setShield(SHIELD_MAX); sfx("pickup");
            guide("盾を構えた。正面からの攻撃を拳銃3発ぶん防ぐ（ショットガンは1発で壊れる）",5);
          }
          refreshHud();
        },0.72);
      const sO=keyReg[it.id].it, sOrig=sO.use;
      sO.use=()=>{
        if(shield>0){ guide("すでに盾を構えている",2); return; }
        sOrig();
      };
    }else{
      makeItem(it.id,makePotionMesh(1.0),it.x,it.y,it.z,"回復薬を拾う",
        (slot)=>{
          if(mode!=="team") return;
          P[slot].pot=1;
          if(slot===net.mySlot){ hasPot=true; guide("回復薬を持った。倒れた仲間に届けろ",4); }
          refreshHud();
        },0.42);
      const o=keyReg[it.id].it, orig=o.use;
      o.use=()=>{
        if(mode==="team"){
          if(shield>0){ guide("盾を持っていると回復薬は持てない",2); return; }
          if(hasPot){ guide("すでに回復薬を持っている",2); return; }
          orig(); return;
        }
        if(lives>=LIVES){ guide("ライフは満タンだ",2); return; }
        orig();
      };
    }
  }
}
function grantKey(id,slot){
  const k=keyReg[id]; if(!k||keyOwner[id]!=null) return;
  keyOwner[id]=slot;
  scene.remove(k.g);
  const i=interacts.indexOf(k.it); if(i>=0) interacts.splice(i,1);
  if(slot===net.mySlot){
    inventory[id]=k.name; invColor[id]=cssHex(k.col); refreshInv();
  }
  if(k.onGrant) k.onGrant(slot);
}
/* ショットガン本体は Kel-Tec KSG のモデル。読み込めなければ簡易ポリゴンのまま
   実測: 全長は Z 軸、銃口は -Z（カメラ前方と一致）、上は +Y なので回転は不要 */
const SGMODEL={ ready:false, scene:null, base:1, grip:new THREE.Vector3() };
const sgVisuals=[];
const SG_LEN=0.66;                                    // 全長(m)
const SG_GRIP=new THREE.Vector3(0,-0.087,0.057);      // bbox中心からグリップまで(全長比)
function loadShotgunModel(){
  const buf=window.ASSETS&&ASSETS.shotgun;
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
    SGMODEL.base=SG_LEN/maxd;
    const c=new THREE.Vector3().addVectors(b.min,b.max).multiplyScalar(0.5);
    SGMODEL.grip.set(c.x+SG_GRIP.x*maxd, c.y+SG_GRIP.y*maxd, c.z+SG_GRIP.z*maxd);
    SGMODEL.scene=root; SGMODEL.ready=true;
    for(const g of sgVisuals) applySgModel(g);
  },()=>{});
}
function applySgModel(g){
  if(!SGMODEL.ready) return;
  while(g.children.length) g.remove(g.children[0]);
  const inst=SGMODEL.scene.clone(true);
  const s=SGMODEL.base*(g.userData.sgScale||1);
  inst.scale.setScalar(s);
  inst.position.set(-SGMODEL.grip.x*s,-SGMODEL.grip.y*s,-SGMODEL.grip.z*s); // グリップを原点へ
  g.add(inst);
}
function makeShotgunMesh(scale){
  const g=new THREE.Group();
  g.userData.sgScale=scale||1;
  sgVisuals.push(g);
  g.add(makeProcShotgun(scale));
  if(SGMODEL.ready) applySgModel(g);
  return g;
}
function makeProcShotgun(s){
  s=s||1;
  const g=new THREE.Group();
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.030*s,0.030*s,0.62*s,8),MAT.gunmetal);
  barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.030*s,-0.20*s); g.add(barrel);
  const tube=new THREE.Mesh(new THREE.CylinderGeometry(0.024*s,0.024*s,0.50*s,8),MAT.gunslide);
  tube.rotation.x=Math.PI/2; tube.position.set(0,-0.022*s,-0.16*s); g.add(tube);
  const pump=new THREE.Mesh(new THREE.BoxGeometry(0.058*s,0.052*s,0.15*s),MAT.gungrip);
  pump.position.set(0,-0.022*s,-0.13*s); g.add(pump);
  const recv=new THREE.Mesh(new THREE.BoxGeometry(0.070*s,0.100*s,0.24*s),MAT.gunmetal);
  recv.position.set(0,0.010*s,0.16*s); g.add(recv);
  const stock=new THREE.Mesh(new THREE.BoxGeometry(0.062*s,0.095*s,0.30*s),MAT.wood);
  stock.position.set(0,-0.020*s,0.42*s); stock.rotation.x=-0.07; g.add(stock);
  const grip=new THREE.Mesh(new THREE.BoxGeometry(0.056*s,0.135*s,0.085*s),MAT.gungrip);
  grip.position.set(0,-0.085*s,0.28*s); grip.rotation.x=-0.26; g.add(grip);
  const sight=new THREE.Mesh(new THREE.BoxGeometry(0.014*s,0.022*s,0.02*s),MAT.metal);
  sight.position.set(0,0.062*s,-0.50*s); g.add(sight);
  return g;
}
/* 拾えるアイテム（鍵と同じ先着ルールに乗せる） */
function makeItem(id,mesh,x,y,z,labelText,onGrant,lift){
  const sp=freeSpot(x,z,y); x=sp[0]; z=sp[1];
  const g=mesh; const base=y+(lift||0.55);
  g.position.set(x,base,z); scene.add(g);
  tickers.push(dt=>{ if(!g.parent)return; g.rotation.y+=dt*0.9;
    g.position.y=base+Math.sin(performance.now()*0.0022)*0.05; });
  const it={
    pos:new THREE.Vector3(x,y+0.6,z), r:2.3,
    label:()=> keyOwner[id]!=null?null:labelText,
    use:()=>{ if(keyOwner[id]==null) act({t:"want",id:id}); }
  };
  interacts.push(it);
  keyReg[id]={g:g,it:it,name:labelText,col:0xd8d8d8,onGrant:onGrant};
}
function setWeapon(w){
  weapon=w;
  if(viewGun) viewGun.visible=(w===0)&&alive&&started;
  if(viewSG)  viewSG.visible =(w===1)&&alive&&started;
  sfx("pickup");
}
/* 地下のショットガンが取られたら屋上にもう1挺出す */
function spawnRoofShotgun(){
  if(keyReg.sg2) return;
  makeItem("sg2",makeShotgunMesh(1.0),0,ROOF_Y,-5.0,"ショットガンを拾う",
    (slot)=>{
      P[slot].w=1;
      if(slot===net.mySlot){ setWeapon(1); guide("ショットガンは、近距離で威力を発揮する",5); }
      else guide("誰かがショットガンを手に入れた。",5);
    },0.55);
}
function refreshInv(){
  if(!invList) return;
  const ids=Object.keys(inventory);
  if(ids.length===0){ invList.className="none"; invList.textContent="なし"; return; }
  invList.className="";
  invList.innerHTML=ids.map(id=>{
    const c=invColor[id]||"#8b8578";
    return '<span style="color:'+c+';text-shadow:0 0 6px '+c+'">■</span> '+inventory[id];
  }).join("<br>");
}

/* ============================================================
   照明（全館トグル）
   ============================================================ */
function setLights(on){
  flags.lightsOn=on;
  for(const c of ceilLamps) c.lamp.material = on?MAT.lampOn:MAT.lampOff;
  flashOn = !on;                       // 消灯したら懐中電灯が自動でオン
  if(lightSwitches) for(const s of lightSwitches){
    s.led.material = on?MAT.lampOn:MAT.lampOff;
    s.lever.rotation.x = on?0.9:0;
  }
}
let lightSwitches=null;
const evPanels=[];
/* 1Fは参照元の公衆電話があった場所 (-11.4, 0, 2.28)。5Fは廊下の北側の壁 */
function buildEvPower(y){
  const x=-11.4, z=2.28;
  const g=new THREE.Group(); g.position.set(x,y+1.42,z); scene.add(g);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.78,1.05,0.26),MAT.metal));
  const door=new THREE.Mesh(new THREE.BoxGeometry(0.70,0.95,0.04),MAT.dark);
  door.position.z=-0.15; g.add(door);
  const lever=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.34,0.10),MAT.metal);
  lever.position.set(-0.16,-0.10,-0.24); g.add(lever);
  const led=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8),MAT.lampOn);
  led.position.set(0.20,0.22,-0.19); g.add(led);
  const pl=new THREE.Mesh(new THREE.PlaneGeometry(0.62,0.18),
    new THREE.MeshBasicMaterial({map:label("ELEVATOR POWER","#20242b","#e8a13a",256,72)}));
  pl.position.set(0,0.36,-0.18); pl.rotation.y=Math.PI; g.add(pl);
  interacts.push({
    pos:new THREE.Vector3(x,y+1.42,z-0.55), r:2.3,
    label:()=> evWanted?"エレベーターの電源を切る":"エレベーターの電源を入れる",
    use:()=>{ act({t:"evpower",on:!evWanted}); }
  });
  const pn={led:led,lever:lever,g:g,it:interacts[interacts.length-1]};
  evPanels.push(pn);
  return pn;
}
/* 電源の状態表示 */
function refreshEvPanel(){
  for(const pn of evPanels){
    pn.led.material=evWanted?MAT.lampOn:MAT.lampOff;
    pn.lever.rotation.x=evWanted?0:0.9;
  }
}
function applyEvMsg(on){
  guide(on?"誰かがエレベーターの電源を入れた":"誰かがエレベーターの電源を切った",4);
  sfx(on?"power":"locked");
}
function makeLightSwitch(y,z,caption,px){
  const X=(px==null)?7:px;
  const s=(z>0)?-1:1;                     // 部屋の内側を向く方向
  const g=new THREE.Group(); g.position.set(X,y+1.35,z); scene.add(g);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5,1.15,0.22),MAT.metal));
  const lever=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.42,0.1),MAT.dark);
  lever.position.set(0,-0.2,0.2*s); g.add(lever);
  const led=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8),MAT.lampOn);
  led.position.set(0.45,0.32,0.14*s); g.add(led);
  const pl=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.24),
    new THREE.MeshBasicMaterial({map:label(caption,"#20242b","#e8a13a",256,68)}));
  pl.position.set(0,0.34,0.12*s); pl.rotation.y=(s<0)?Math.PI:0; g.add(pl);
  const it={
    pos:new THREE.Vector3(X,y+1.35,z+0.35*s), r:2.2,
    label:()=> flags.lightsOn?"照明を消す":"照明を点ける",
    use:()=>{ act({t:"lights",on:!flags.lightsOn}); }
  };
  interacts.push(it);
  return {led:led,lever:lever,it:it,y:y,g:g};
}
/* メニューのBGM（元のホラー版で最初に流れる曲）。
   自動再生は各ブラウザで止められるので、最初の操作を合図に鳴らす */
let bgmOn=true, bgmVol=0;
function bgmTarget(){ return (bgmOn&&!started&&!finished)?0.42:0; }
function bgmKick(){
  if(!bgmEl||!bgmOn||started) return;
  if(!bgmEl.paused) return;
  try{ bgmEl.volume=0; const p=bgmEl.play(); if(p&&p.catch) p.catch(()=>{}); }catch(e){}
}
function updateBgmMenu(dt){
  if(!bgmEl) return;
  const t=bgmTarget();
  bgmVol+=(t-bgmVol)*Math.min(1,dt*(t>bgmVol?2.2:1.4));
  if(bgmVol<0.005&&t===0){
    bgmVol=0;
    if(!bgmEl.paused){ try{ bgmEl.pause(); }catch(e){} }
  }
  try{ bgmEl.volume=Math.max(0,Math.min(1,bgmVol)); }catch(e){}
}

/* 1F閉鎖の警報。赤い明滅が出ている本人にだけ鳴らす */
let alarmVol=0;
function alarmWanted(){
  return started && !finished && alive &&
         inWarnZone(player.pos.x,player.pos.y,player.pos.z);
}
function updateAlarm(dt){
  if(!alarmEl) return;
  const want=alarmWanted();
  if(want&&alarmEl.paused){
    try{ alarmEl.volume=0; alarmEl.currentTime=0;
      const p=alarmEl.play(); if(p&&p.catch) p.catch(()=>{}); }catch(e){}
  }
  const t=want?0.60:0;
  alarmVol+=(t-alarmVol)*Math.min(1,dt*(t>alarmVol?6.0:4.0));
  if(alarmVol<0.01&&t===0){
    alarmVol=0;
    if(!alarmEl.paused){ try{ alarmEl.pause(); }catch(e){} }
  }
  try{ alarmEl.volume=Math.max(0,Math.min(1,alarmVol)); }catch(e){}
}

/* ガイドテキスト（画面中央やや上） */
let msgT=0;
function guide(text,secs){
  if(!msgEl||!text) return;
  msgEl.innerHTML=text; msgEl.style.opacity="1"; msgT=secs||5;
}
function updateGuide(dt){
  if(msgT>0){ msgT-=dt; if(msgT<=0&&msgEl) msgEl.style.opacity="0"; }
}

/* ============================================================
   エレベーター（ホストが動かし、位置を配信する）
   ============================================================ */
function elevGoTo(fi,isCall){
  if(mode==="team"&&!teamElevRequest(fi,!!isCall)) return;
  if(net.isHost||!net.on) elevGoToSim(fi);
  else act({t:"elevcall",f:fi,call:!!isCall});
}
function updateElev(dt){
  if(net.isHost||!net.on){ updateElevSim(dt); return; }
  elev.platform.position.y=elev.y;
  for(const dd of elev.doors){
    const opening=(dd.fi===elev.floor)?elev.doorT:0;
    dd.p.position.z=-opening*1.85;
    dd.col.active=opening<0.55;
    dd.callLite.material=(dd.fi===elev.floor)?MAT.lampOn:MAT.lampOff;
  }
  elev.light.intensity=0.70; elev.lamp.material=MAT.lampOn;
}

/* ============================================================
   梯子（地下との昇降）
   ============================================================ */
const climb={active:false,t:0,dur:1.8,fx:0,fy:0,fz:0,tx:0,ty:0,tz:0};
function startClimb(tx,ty,tz){
  climb.active=true; climb.t=0;
  climb.fx=player.pos.x; climb.fy=player.pos.y; climb.fz=player.pos.z;
  climb.tx=tx; climb.ty=ty; climb.tz=tz;
  promptEl.style.opacity=0; sfx("step");
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
  if(k>=1) climb.active=false;
}

/* ============================================================
   フロア構築
   ============================================================ */
const ROOMS={
  4:[ // 5F
    {id:"5A",name:"資料室 5A",side:"N",left:true ,locked:false},
    {id:"5B",name:"会議室",   side:"N",left:false,locked:false},
    {id:"5C",name:"給湯室",   side:"S",left:true ,locked:false},
    {id:"5D",name:"備品庫 5D",side:"S",left:false,locked:false}
  ],
  3:[ // 4F
    {id:"4A",name:"倉庫 4A",  side:"N",left:true ,locked:false},
    {id:"4B",name:"応接室",   side:"N",left:false,locked:false},
    {id:"4C",name:"事務室 4C",side:"S",left:true ,locked:false},
    {id:"4D",name:"休憩室 4D",side:"S",left:false,locked:false}
  ],
  2:[ // 3F
    {id:"3A",name:"資料室 3A",side:"N",left:true ,locked:false},
    {id:"3B",name:"会議室",   side:"N",left:false,locked:false},
    {id:"3C",name:"給湯室",   side:"S",left:true ,locked:false},
    {id:"3D",name:"備品庫 3D",side:"S",left:false,locked:false}
  ],
  1:[ // 2F
    {id:"2A",name:"倉庫 2A",  side:"N",left:true ,locked:false},
    {id:"2B",name:"機械室 2B",side:"N",left:false,locked:false},
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
    // 部屋の間仕切り（AとB、CとDは内側のドアでつながる）
    wallZ(0, 2.5,9,y,MAT.wall,[[5.0,6.5]]);
    wallZ(0,-9,-2.5,y,MAT.wall,[[-6.5,-5.0]]);
    const rr=ROOMS[fi];
    makeDoor({x:0,y:y,z: 5.75,axis:"z",width:1.5,hingeSign: 1,locked:false,
      name:rr[0].name+" ⇄ "+rr[1].name,sign:rr[0].id+"/"+rr[1].id,faceSign:1});
    makeDoor({x:0,y:y,z:-5.75,axis:"z",width:1.5,hingeSign:-1,locked:false,
      name:rr[2].name+" ⇄ "+rr[3].name,sign:rr[2].id+"/"+rr[3].id,faceSign:1});
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
const RESERVED=[                       // 家具を置かない場所
  {x:7,z: 8.4,r:2.2},{x:7,z:-8.4,r:2.2},   // 電源盤の前（2B/3B/4D/5D）
  {x:0,z: 5.75,r:2.0},{x:0,z:-5.75,r:2.0}  // 部屋どうしをつなぐドアの前
];
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
  const H=ROOF_Y+3.6, W=8.9;   // 屋上の塔屋ぶんまで立ち上げる
  box(T,H,6.4,-22.8,H/2,0,MAT.concrete);
  box(W,H,T,-18.35,H/2,3.1,MAT.concrete);
  box(W,H,T,-18.35,H/2,-3.1,MAT.concrete);
  box(W,0.3,6.4,-18.35,H+0.1,0,MAT.concrete);     // 塔屋の天井
  box(4.0,H,0.24,-19,H/2,0,MAT.concrete);         // 中央の仕切り壁（転落防止）
  // 最上階(3F)の「上り側」と最下階(1F)の「下り側」はその先に階段が存在しない。
  // ふさがないと3Fでは4mの落差、1Fでは階段下の空洞に入り込んで戻れなくなる。
  box(T,3.4,3.1,-17,ROOF_Y+1.7,1.55,MAT.concrete); // 屋上 踊り場・上り側（最上部）
  box(T,3.4,3.1,-17,1.7,-1.55,MAT.concrete);       // 1F 踊り場・下り側（最下部）
  // 塔屋の壁（屋上側）。ここに屋上へ出る扉がつく
  box(T,0.8,6.2,-14,ROOF_Y-0.4,0,MAT.concrete,{los:false});
  wallZ(-14,-3,3,ROOF_Y,MAT.concrete,[[-0.9,0.9]],3.6);
  const base=new THREE.Mesh(new THREE.BoxGeometry(W,0.3,6.4),MAT.concrete);
  base.position.set(-18.35,-0.15,0); scene.add(base);

  for(const sy of [5.5,13.5,19.5]){
    const sl=new THREE.PointLight(0xff3a26,0.42,30); sl.position.set(-17.5,sy,0); scene.add(sl);
    emergLights.push(sl); emergFloor.push(-1);
  }
  for(const L of LEVELS){
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
  const H=ROOF_Y+3.0;
  box(T,H,6.4,20.1,H/2,0,MAT.metal);
  box(6.2,H,T,17,H/2,3.1,MAT.metal);
  box(6.2,H,T,17,H/2,-3.1,MAT.metal);
  box(6.2,0.3,6.4,17,H+0.1,0,MAT.metal);
  /* 屋上に立つ機械室の壁。屋上側にも扉の開口（z-0.95〜0.95・y=ROOF_Y〜+2.2）を空ける */
  const MY0=ROOF_Y-0.8, MH=H-MY0;
  box(T,MH,2.25,14,MY0+MH/2,-2.075,MAT.metal);
  box(T,MH,2.25,14,MY0+MH/2, 2.075,MAT.metal);
  box(T,ROOF_Y-MY0,1.9,14,(MY0+ROOF_Y)/2,0,MAT.metal);
  box(T,H-(ROOF_Y+2.2),1.9,14,(ROOF_Y+2.2+H)/2,0,MAT.metal);
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
  for(let fi=0;fi<EV_STOPS;fi++){
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
      label:()=> (mode==="team"&&!teamBoardFloor(fi))? "呼びボタン（この階からは動かせない）"
                 : floorClosed(fi)? "呼びボタン（このフロアは閉鎖済み）"
                 : (flags.power? "エレベーターを呼ぶ" : "エレベーターの呼びボタン（無反応）"),
      use:()=>{
        if(floorClosed(fi)){ sfx("locked"); return; }
        if(!flags.power){ say("ボタンは沈むだけで、何も起きない。\n電源が落ちているようだ。"); sfx("locked"); return; }
        if(elev.state==="moving"){ say("エレベーターは移動中だ。"); return; }
        if(elev.floor===fi&&elev.state==="open"){ say("エレベーターはもう来ている。"); return; }
        elevGoTo(fi,true); say("エレベーターを呼んだ。");
      }
    });
    // 階数表示
    const sg=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.32),
      new THREE.MeshBasicMaterial({map:label(FLOOR_NAME[fi],"#1c2027","#e8a13a",256,128)}));
    sg.position.set(13.86,y+2.3,0); sg.rotation.y=-Math.PI/2; scene.add(sg);
  }
}
function elevGoToSim(fi){
  if(!flags.power) return;
  if(floorClosed(fi)) return;           // 閉鎖されたフロアには停まらない
  if(elev.state==="moving") return;
  elev.target=fi;
  if(elev.floor===fi&&(elev.state==="open"||elev.state==="opening")) return;
  elev.state = (elev.state==="closed") ? "moving" : "closing";
  sfx("bell");
}
function updateElevSim(dt){
  const d=elev.doors[elev.floor];
  if(flags.power&&floorClosed(elev.floor)&&elev.state!=="moving"){
    /* このフロアは封鎖済み。扉は閉じたままにし、別の階を選べば動き出す */
    if(elev.doorT>0) elev.doorT=Math.max(0,elev.doorT-dt*1.6);
    else elev.state="closed";
    elev.platform.position.y=elev.y;
    for(const dd of elev.doors){
      const opening=(dd.fi===elev.floor)?elev.doorT:0;
      dd.p.position.z=-opening*1.85;
      dd.col.active=opening<0.55;
      dd.callLite.material=MAT.lampOff;
    }
    elev.light.intensity=0.70; elev.lamp.material=MAT.lampOn;
    return;
  }
  if(!flags.power){
    /* 電源が落ちている間は昇降せず、扉は閉じたまま */
    if(elev.doorT>0){
      elev.doorT=Math.max(0,elev.doorT-dt*1.6);
      if(elev.doorT<=0&&elev.state!=="moving") elev.state="closed";
    }
    elev.platform.position.y=elev.y;
    for(const dd of elev.doors){
      const opening=(dd.fi===elev.floor)?elev.doorT:0;
      dd.p.position.z=-opening*1.85;
      dd.col.active=opening<0.55;
      dd.callLite.material=MAT.lampOff;
    }
    elev.light.intensity=0; elev.lamp.material=MAT.lampOff;
    return;
  }
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
function toLambert(mat){
  const tr=!!mat.transparent;
  const m=new THREE.MeshLambertMaterial({
    map:mat.map||null, color:mat.color?mat.color.clone():new THREE.Color(0xffffff),
    skinning:true, side:tr?THREE.DoubleSide:THREE.FrontSide,
    transparent:tr, alphaTest:tr?0.08:0, depthWrite:!tr
  });
  if(m.map) m.map.encoding=THREE.sRGBEncoding;
  return m;
}
function losClear(from,to){
  const d=new THREE.Vector3().subVectors(to,from);
  const dist=d.length(); if(dist<0.2) return true;
  d.normalize();
  const ray=new THREE.Raycaster(from,d,0.2,dist-0.2);
  const hits=ray.intersectObjects(losBlockers,false);
  return hits.length===0;
}
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
const ZOMBIE_R=0.68;   // 前に伸ばした腕の先まで含めた半径（腕が壁を貫通しないように）
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
  for(const L of LEVELS){ if(L<=0) continue; const v=stairSurface(x,z,L); if(v!==null) low=Math.min(low,v); }
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
    for(const L of LEVELS){ const s=stairSurface(x,z,L); if(s!==null)c.push(s); }
    c.push(0);
  }
  else if(z<-9.2||z>9.2||x>14.2||x<-14.2){ c.push(0); }
  else { for(const L of LEVELS) c.push(L); }
  if(inBasement(x,z)) c.push(BASE_Y);
  let best=-999;
  for(const v of c) if(v<=feetY+0.62&&v>best) best=v;
  if(best===-999){ best=Math.min.apply(null,c); }
  return best;
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
function playGunShot(mul,rate,muffle){
  mul=mul||1; rate=rate||1;
  if(gunBuf&&AC&&masterGain){
    try{
      const s=AC.createBufferSource(); s.buffer=gunBuf;
      if(s.playbackRate) s.playbackRate.value=rate;
      const g=AC.createGain(); g.gain.value=0.9*mul;
      if(muffle){                       // 別フロア＝床越しにこもって届く
        const f=AC.createBiquadFilter();
        f.type="lowpass"; f.frequency.value=240; f.Q.value=0.6;
        const f2=AC.createBiquadFilter();
        f2.type="lowpass"; f2.frequency.value=240; f2.Q.value=0.6;
        s.connect(f); f.connect(f2); f2.connect(g);
      }else{
        s.connect(g);
      }
      g.connect(masterGain); s.start();
      return;
    }catch(e){}
  }
  if(!gunPool.length){ sfx("shot"); return; }
  const a=gunPool[gunIdx++%gunPool.length];
  try{ a.volume=Math.min(1,0.8*mul); a.playbackRate=rate; }catch(e){}
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
    case "clang":  tone("square",1250,760,0.10,0.16); tone("square",820,430,0.18,0.12,0.02);
                   noiseBurst(0.14,0.20,2600); break;
    case "break":  tone("square",700,140,0.30,0.16); noiseBurst(0.35,0.22,1500); break;
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
/* 足音。同じフロアなら距離で減衰、非常階段の中の足音はどこにいても届く */
const SHAFT_X=-14.0, SHAFT_Z=3.3;
function inShaft(x,z){ return x<SHAFT_X && Math.abs(z)<SHAFT_Z; }
function stepAt(x,y,z,run,cr){
  if(!AC) return;
  const srcShaft=inShaft(x,z);
  const lisShaft=inShaft(player.pos.x,player.pos.z);
  if(srcShaft&&!lisShaft) return;      // 階段の足音は、階段の中にいる者にしか届かない
  const same=Math.abs(y-player.pos.y)<2.0;
  if(!srcShaft&&!same) return;
  /* 同じフロアの床を踏む音か、非常階段に響く音か */
  const onFloor=!srcShaft;
  const d=Math.hypot(x-player.pos.x,y-player.pos.y,z-player.pos.z);
  const max=onFloor?30:34;            // 廊下は27.8mあるので端まで届かせる
  if(d>max) return;
  let k=1-d/max;
  if(!onFloor) k*=0.72;               // 階段の音が全館を埋め尽くさないように
  if(k<0.02) return;
  const v=k*(run?1.3:(cr?0.55:1.0));   // しゃがみ移動は静か
  if(onFloor){
    noiseBurst(0.085,0.34*v,300);     // カーペットを踏む鈍い音
    tone("sine",125,58,0.11,0.22*v);
    tone("square",210,120,0.045,0.05*v);
  }else{
    noiseBurst(0.070,0.30*v,900);     // 鉄骨階段の硬く高い音
    tone("sine",150,70,0.09,0.13*v);
  }
}
let stepT=0;
function footstep(dt,run,cr){
  stepT-=dt*(run?3.15:(cr?1.20:2.03));
  if(stepT<=0){ stepT=1; stepAt(player.pos.x,player.pos.y,player.pos.z,run,cr); }
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
   他プレイヤーのアバター
   ============================================================ */
function makeAvatar(slot){
  const col=SLOT_COL[slot];
  const body=new THREE.MeshLambertMaterial({color:col,emissive:dimCol(col,0.22)});
  const dark=new THREE.MeshLambertMaterial({color:dimCol(col,0.45)});
  const g=new THREE.Group();
  const core=new THREE.Group(); g.add(core);   // しゃがみで縦に縮める部分
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.62,0.30),body);
  torso.position.y=1.16; core.add(torso);
  const hip=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.18,0.28),dark);
  hip.position.y=0.80; core.add(hip);
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.30,0.30,0.30),body);
  head.position.y=1.63; core.add(head);
  const visor=new THREE.Mesh(new THREE.BoxGeometry(0.31,0.09,0.02),
    new THREE.MeshBasicMaterial({color:0x0e1216}));
  visor.position.set(0,1.66,-0.155); core.add(visor);
  const legs=[],arms=[];
  for(const s of [-1,1]){
    const lg=new THREE.Group(); lg.position.set(s*0.14,0.78,0); core.add(lg);
    const l=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.76,0.20),dark);
    l.position.y=-0.38; lg.add(l); legs.push(lg);
    const ag=new THREE.Group(); ag.position.set(s*0.34,1.42,0); core.add(ag);
    const a=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.56,0.16),body);
    a.position.y=-0.28; ag.add(a); arms.push(ag);
  }
  const hold=new THREE.Group();
  hold.position.set(0.30,1.18,-0.28); core.add(hold);
  const flash=new THREE.PointLight(0xffd9a0,0,6); flash.position.set(0.30,1.20,-0.6); core.add(flash);
  FX.avatar(slot,core,legs,arms,body,dark);
  scene.add(g);
  const av={g:g,core:core,legs:legs,arms:arms,flash:flash,hold:hold,w:-1,t:0,fl:0,crv:0};
  setAvatarWeapon(av,P[slot].w||0);
  return av;
}

/* ============================================================
   通信（PeerJS・ホスト中継のスター型）
   ============================================================ */
const ROOM_PREFIX="office-warfare-";
const net={
  on:false, isHost:false, peer:null, hostConn:null, conns:{},
  mySlot:0, room:"", started:false
};
/* 全員ぶんの状態。slot -> {used,x,y,z,yaw,mov,lives,alive,av,tx,ty,tz,tyaw} */
const P=[];
for(let i=0;i<MAXP;i++) P.push({used:false,x:0,y:0,z:0,yaw:0,mov:0,lives:LIVES,alive:true,av:null,tx:0,ty:0,tz:0,tyaw:0,ready:false});

function code4(){
  let r="";
  for(let i=0;i<4;i++) r+=String(Math.floor(Math.random()*10));
  return r;
}
function bcast(msg,except){
  for(const k in net.conns){
    const c=net.conns[k];
    if(!c||!c.open) continue;
    if(except!=null&&Number(k)===except) continue;
    try{ c.send(msg); }catch(e){}
  }
}
/* ローカルで起きたイベント。ホストなら直接処理、ゲストならホストへ送る */
function act(msg){
  if(!net.on){ hostHandle(msg,0); return; }
  if(net.isHost) hostHandle(msg,net.mySlot);
  else if(net.hostConn&&net.hostConn.open) net.hostConn.send(msg);
}
/* ホスト側の裁定 */
function hostHandle(m,from){
  switch(m.t){
    case "pos":{
      const p=P[from]; if(!p)return;
      p.tx=m.x;p.ty=m.y;p.tz=m.z;p.tyaw=m.yaw;p.mov=m.mov;p.cr=m.c?1:0;
      if(!p.init){ p.x=m.x;p.y=m.y;p.z=m.z;p.yaw=m.yaw;p.init=true; }
      break;
    }
    case "want":{
      if(keyOwner[m.id]!=null) return;
      if(m.id.indexOf("sh")===0&&(P[from]&&P[from].sh>0)) return;   // 盾は1枚まで
      if(mode==="team"&&m.id.indexOf("hp")===0&&P[from]&&(P[from].sh>0||P[from].pot)) return;
      const out={t:"key",id:m.id,slot:from};
      grantKey(m.id,from); bcast(out);
      /* 回復薬は取得した時点でライフが1回復する（満タンなら何も起きない） */
      if(m.id.indexOf("hp")===0){
        const p=P[from];
        if(p&&p.alive&&p.lives<LIVES){
          p.lives++;
          const h={t:"heal",slot:from,lives:p.lives};
          applyHeal(h); bcast(h);
        }
      }
      break;
    }
    case "door":{
      const d=doors[m.i];
      if(!d||d.open) return;
      if(d.locked&&keyOwner[d.keyId]!==from) return;   // 鍵を持つ本人だけが開けられる
      applyDoor(m.i); bcast({t:"door",i:m.i});
      break;
    }
    case "lights":{
      const out={t:"lights",on:!!m.on};
      setLights(!!m.on); bcast(out);
      break;
    }
    case "elevcall":{
      if(mode==="team"&&!teamElevRequest(m.f,!!m.call)) return;
      elevGoToSim(m.f);
      break;
    }
    case "zhit":{
      hostZombieHit(m.id,m.dmg,from);
      break;
    }
    case "tsw":{
      if(mode!=="team"||teamCallOk[m.f]) return;
      applyTsw(m.f);
      if(net.isHost&&net.on) bcast({t:"tswok",f:m.f});
      if(m.f===0){                       // 地下のスイッチで屋上のゾンビとボスが現れる
        const list=spawnZombieList(teamPlayers,[5]);
        placeZombies(list); spawnBoss();
        if(net.isHost&&net.on) bcast({t:"zsp",a:list,boss:1});
      }
      break;
    }
    case "evpower":{
      const on=!!m.on;
      if(evWanted===on) return;
      evWanted=on;
      applyEvMsg(on);
      bcast({t:"evmsg",on:on});
      break;
    }
    case "fire":{
      bcast({t:"fire",slot:from,w:m.w||0},from);
      if(from!==net.mySlot) remoteFire(from,m.w||0);
      break;
    }
    case "hit":{
      const tgt=P[m.target];
      if(!tgt||!tgt.used||!tgt.alive) return;
      if(mode==="team"&&m.by!==m.target&&from!==m.target) return;   // 味方の弾は当たらない
      /* NPCの弾はホスト自身が送るので、撃った本人は by で受け取る */
      const shooter=(from===net.mySlot&&m.by!=null)?m.by:from;
      if(tgt.down>0) return;
      if(performance.now()<(tgt.safeUntil||0)) return;
      tgt.safeUntil=performance.now()+250;   // 同時着弾の二重取りだけを防ぐ（本命の無敵は down）
      /* 盾。正面からの攻撃だけを防ぎ、ヘッドショットは貫通する */
      if(!m.head&&(tgt.sh||0)>0&&shieldFacing(m.target,shooter)){
        tgt.sh=Math.max(0,tgt.sh-(m.w?SHIELD_MAX:1));
        const bk={t:"blk",slot:m.target,sh:tgt.sh};
        applyBlk(bk); if(net.isHost&&net.on) bcast(bk);
        return;
      }
      if(mode==="team"){
        /* Teamはライフもリスポーンもない。その場に倒れて助けを待つ */
        if(tgt.dn) return;
        let kx=0,kz=1;
        const s=posOf(shooter), t=posOf(m.target);
        kx=t.x-s.x; kz=t.z-s.z;
        const l=Math.hypot(kx,kz)||1; kx/=l; kz/=l;
        const dm={t:"tdown",slot:m.target,kx:Math.round(kx*100)/100,kz:Math.round(kz*100)/100};
        applyTdown(dm); if(net.isHost&&net.on) bcast(dm);
        return;
      }
      tgt.lives--;
      if(tgt.lives<=0){ tgt.lives=0; tgt.alive=false; }
      const out={t:"life",slot:m.target,lives:tgt.lives,alive:tgt.alive,by:shooter,
                 sp:freeSpawnFor(m.target)};
      applyLife(out); bcast(out);
      checkEnd();
      break;
    }
  }
}
/* 盾が受け止められる向きか（相手が撃ってきた方向が正面±72度以内） */
const SHIELD_DOT=0.30;
function shieldFacing(tslot,sslot){
  const t=posOf(tslot), s=posOf(sslot);
  let vx=s.x-t.x, vz=s.z-t.z;
  const l=Math.hypot(vx,vz);
  if(l<0.2) return true;
  vx/=l; vz/=l;
  const yaw=(tslot===net.mySlot)?player.yaw:(P[tslot].yaw||0);
  return (-Math.sin(yaw)*vx - Math.cos(yaw)*vz) > SHIELD_DOT;
}
function applyDoor(i){
  const d=doors[i]; if(!d||d.open) return;
  d.locked=false; d.open=true; d.col.active=false; sfx("door");
}
function applyLife(m){
  const p=P[m.slot]; if(!p) return;
  FX.life(m);
  p.lives=m.lives; p.alive=m.alive;
  /* 撃たれた方向へ吹っ飛ぶ */
  let kx=0,kz=1;
  if(m.by!=null&&m.by!==m.slot){
    const s=posOf(m.by), t=posOf(m.slot);
    kx=t.x-s.x; kz=t.z-s.z;
    const l=Math.hypot(kx,kz)||1; kx/=l; kz/=l;
  }
  p.down=DOWN_T; p.dkx=kx; p.dkz=kz; p.pendSp=m.sp; p.mov=0;
  p.respT=DOWN_T; p.respSent=false;
  if(m.slot===net.mySlot){
    lives=m.lives; alive=m.alive;
    if(m.sp!=null&&SPAWNS[m.sp]) mySpawn=SPAWNS[m.sp];
    sfx("hit"); startDown(kx,kz);
  }
  refreshHud();
}
/* 最後の一人が倒れきってから決着にする */
let pendingEnd=null;
function checkEnd(){
  if(!net.isHost&&net.on) return;
  if(pendingEnd) return;
  if(mode==="team"){
    let n=0;
    for(let i=0;i<MAXP;i++) if(P[i].used&&P[i].alive) n++;
    if(n===0&&!finished) teamFinish("wipe");
    return;
  }
  let n=0,w=-1;
  for(let i=0;i<MAXP;i++) if(P[i].used&&P[i].alive){ n++; w=i; }
  if(n<=1) pendingEnd={winner:w,t:DOWN_T};
}
function updatePendingEnd(dt){
  if(!pendingEnd) return;
  pendingEnd.t-=dt;
  if(pendingEnd.t>0) return;
  const out={t:"end",winner:pendingEnd.winner};
  pendingEnd=null;
  applyEnd(out);
  if(net.isHost&&net.on) bcast(out);
}
function applyEnd(m){
  if(finished) return;
  finished=true;
  document.exitPointerLock&&document.exitPointerLock();
  const me=(m.winner===net.mySlot);
  winTitle.textContent = m.winner<0?"DRAW":(me?"WINNER":"GAME OVER");
  winTitle.style.color = m.winner<0?"#e6e2d8":(me?"#e8c23a":"#a3271f");
  winText.innerHTML = m.winner<0 ? "全員が脱落した。"
    : '<b style="color:'+SLOT_CSS[m.winner]+'">'+SLOT_NAME[m.winner]+'</b> が最後まで生き残った。';
  winEl.style.display="flex";
  FX.result();
}
/* 受信 */
function onData(m,from){
  if(!m||!m.t) return;
  if(net.isHost){
    if(m.t==="hello"){ return; }
    hostHandle(m,from);
    if(m.t==="pos") return;
    return;
  }
  switch(m.t){
    case "welcome": net.mySlot=m.slot; net.room=m.room; renderLobby(m.list); break;
    case "lobby":   renderLobby(m.list); break;
    case "start":   beginMatch(m.assign,m.slots,m.mode); break;
    case "snap":{
      for(const q of m.p){
        const p=P[q.s]; if(!p) continue;
        p.used=true; p.lives=q.l; p.alive=q.a;
        if(q.n!=null) p.dn=q.n;
        if(q.pt!=null) p.pot=q.pt;
        if(q.k!=null) p.kills=q.k;
        if(q.s===net.mySlot) continue;
        p.tx=q.x;p.ty=q.y;p.tz=q.z;p.tyaw=q.yaw;p.mov=q.m;p.cr=q.c?1:0;
        if(!p.init){ p.x=q.x;p.y=q.y;p.z=q.z;p.yaw=q.yaw;p.init=true; }
      }
      refreshHud();
      break;
    }
    case "key":    grantKey(m.id,m.slot); break;
    case "door":   applyDoor(m.i); break;
    case "lights": setLights(!!m.on); break;
    case "elevs":  elev.y=m.y; elev.floor=m.f; elev.target=m.tg; elev.state=m.st; elev.doorT=m.dt;
                   flags.power=!!m.p; evWanted=!!m.w; refreshEvPanel(); break;
    case "evmsg":  evWanted=!!m.on; applyEvMsg(!!m.on); refreshEvPanel(); break;
    case "fire":   if(m.slot!==net.mySlot) remoteFire(m.slot,m.w||0); break;
    case "life":   applyLife(m); break;
    case "camp":   applyCamp(m); break;
    case "lock":   applyLockEvent(m.ev); break;
    case "lockf":  if(m.k) applyLockClose(m.f); else applyLockWarn(m.f,TEAM_WARN_LEAD); break;
    case "mode":   mode=m.m; renderMode(); break;
    case "zsp":    placeZombies(m.a); if(m.boss) spawnBoss(); break;
    case "zs":     applyZs(m.a); break;
    case "zhurt":  { const z=findZombie(m.id); if(z) z.hurtT=0.25; break; }
    case "zdie":   applyZdie(m.id,m.by); break;
    case "bhp":    if(boss) boss.hp=m.hp; refreshBoss(); break;
    case "tend":   applyTeamEnd(m); break;
    case "gmsg":   applyGmsg(m); break;
    case "tmsg":   applyTmsg(m.k); break;
    case "tdown":  applyTdown(m); break;
    case "trev":   applyTrev(m); break;
    case "tdead":  applyTdead(m); break;
    case "tpot":   applyTpot(m); break;
    case "tswok":  applyTsw(m.f); break;
    case "kills":  { for(const i in m.k) if(P[i]) P[i].kills=m.k[i]; refreshHud(); break; }
    case "sp":{
      const q=P[m.slot];
      if(q) q.pendSp=m.sp;
      if(m.slot===net.mySlot&&SPAWNS[m.sp]) mySpawn=SPAWNS[m.sp];
      break;
    }
    case "items":  placeItems(m.a); break;
    case "blk":    applyBlk(m); break;
    case "heal":   applyHeal(m); break;
    case "end":    applyEnd(m); break;
  }
}
function remoteFire(slot,w){
  const p=P[slot]; if(!p) return;
  FX.remoteFire(slot,w);
  if(p.av){
    p.av.flash.intensity=w?4.2:3.0;
    setTimeout(()=>{ if(p.av) p.av.flash.intensity=0; },w?100:70);
  }
  const tp=posOf(slot);
  /* 同じフロアなら明瞭、1〜2フロア離れているとこもった音、3フロア以上は届かない */
  const fd=Math.abs(floorIndexOf(tp.y)-floorIndexOf(player.pos.y));
  if(fd>=3) return;
  const muffle=(fd>0);
  const d=Math.hypot(tp.x-player.pos.x,tp.y-player.pos.y,tp.z-player.pos.z);
  const max=w?52:34;
  if(d>=max) return;
  let v=(w?2.0:1.0)*Math.max(0.18,1-d/max);
  if(muffle) v*=0.55*(fd===1?1.0:0.65);
  playGunShot(v, w?1/1.2:1.0, muffle);
}
function lobbyList(){
  const l=[];
  for(let i=0;i<MAXP;i++) if(P[i].used) l.push(i);
  return l;
}
/* --- ホスト --- */
function hostRoom(){
  const room=code4();
  net.isHost=true; net.on=true; net.room=room; net.mySlot=0;
  P[0].used=true;
  lobbyMsg("ルームを作成中…");
  net.peer=new Peer(ROOM_PREFIX+room,{debug:0});
  net.peer.on("open",()=>{
    lobbyShow(room,true);
    renderLobby(lobbyList());
  });
  net.peer.on("error",e=>{ lobbyMsg("接続エラー: "+(e&&e.type?e.type:e)); });
  net.peer.on("connection",conn=>{
    if(net.started){ conn.on("open",()=>{ conn.send({t:"full"}); conn.close(); }); return; }
    const cap=(mode==="team")?MAXP:MAXP_VS;
    let slot=-1;
    for(let i=1;i<cap;i++) if(!P[i].used){ slot=i; break; }
    if(slot<0){ conn.on("open",()=>{ conn.send({t:"full"}); conn.close(); }); return; }
    P[slot].used=true;
    net.conns[slot]=conn;
    conn.on("open",()=>{
      conn.send({t:"welcome",slot:slot,room:net.room,list:lobbyList()});
      bcast({t:"lobby",list:lobbyList()});
      renderLobby(lobbyList());
    });
    conn.on("data",d=>onData(d,slot));
    conn.on("close",()=>{
      P[slot].used=false; P[slot].alive=false;
      if(P[slot].av){ scene.remove(P[slot].av.g); P[slot].av=null; }
      delete net.conns[slot];
      if(!net.started){ bcast({t:"lobby",list:lobbyList()}); renderLobby(lobbyList()); }
      else { refreshHud(); checkEnd(); }
    });
  });
}
/* --- ゲスト --- */
function joinRoom(room){
  net.isHost=false; net.on=true; net.room=room;
  lobbyMsg("ルーム "+room+" に接続中…");
  net.peer=new Peer({debug:0});
  net.peer.on("open",()=>{
    const c=net.peer.connect(ROOM_PREFIX+room,{reliable:true});
    net.hostConn=c;
    c.on("open",()=>{ lobbyShow(room,false); c.send({t:"hello"}); });
    c.on("data",d=>{ if(d&&d.t==="full"){ lobbyMsg("満室、またはすでに開始済みです。"); return; } onData(d,0); });
    c.on("close",()=>{ if(!finished){ lobbyMsg("ホストとの接続が切れました。"); } });
    setTimeout(()=>{ if(!c.open) lobbyMsg("応答がありません。ルームコードを確認してください。"); },7000);
  });
  net.peer.on("error",e=>{ lobbyMsg("接続エラー: "+(e&&e.type?e.type:e)); });
}
/* --- 開始 --- */
function hostStart(){
  const slots=lobbyList();
  if(slots.length<2&&mode!=="team"){ lobbyMsg("2人以上で開始できます。"); return; }
  if(slots.length>MAXP_VS&&mode!=="team"){
    lobbyMsg("5人以上で遊べるのはTeamモードだけです。");
    return;
  }
  const idx=[]; for(let i=0;i<SPAWN_MAIN;i++) idx.push(i);
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=idx[i];idx[i]=idx[j];idx[j]=t; }
  const assign={};
  slots.forEach((s,i)=>{ assign[s]=idx[i]; });
  net.started=true;
  bcast({t:"start",assign:assign,slots:slots,mode:mode});
  beginMatch(assign,slots,mode);
}


/* ============================================================
   NPC（オフラインのテスト対戦用・あまり強くない）
   ============================================================ */
const NPC_SPEED=2.15, NPC_R=0.34;
const NPC_RANGE=24, NPC_SKILL=0.80;    // 射程と腕前（1.0でプレイヤーと同じブレ）
function npcHitChance(d){
  const t=Math.tan(SPREAD)*Math.max(d,1.0);   // その距離での散布半径
  const p=Math.min(1,(HIT_R/t)*(HIT_R/t));    // 円内一様＝距離の二乗に反比例
  return p*NPC_SKILL;
}
function posOf(i){
  if(i===net.mySlot) return player.pos;
  const p=P[i];
  if(p.ai) return p.ai.pos;
  return {x:p.x,y:p.y,z:p.z};
}
function levelOf(y){
  const k=Math.max(0,Math.min(LEVELS.length-1,Math.round(y/FH)));
  return LEVELS[k];
}
function npcInit(slot,spawn){
  const p=P[slot];
  p.used=true; p.alive=true; p.lives=LIVES; p.npc=true; p.init=true;
  p.ai={pos:new THREE.Vector3(spawn.x,spawn.y,spawn.z), y:spawn.y, yaw:spawn.yaw,
        path:[], dest:null, cool:1.5+Math.random(), think:0, stuck:0, lx:spawn.x, lz:spawn.z};
  p.x=p.tx=spawn.x; p.y=p.ty=spawn.y; p.z=p.tz=spawn.z;
  p.yaw=p.tyaw=spawn.yaw; p.mov=0;
}
function npcRespawn(slot,spawn){
  const a=P[slot].ai; if(!a) return;
  a.pos.set(spawn.x,spawn.y,spawn.z); a.y=spawn.y; a.yaw=spawn.yaw;
  a.path=[]; a.dest=null; a.cool=1.4; a.stuck=0;
  const p=P[slot];
  p.x=p.tx=spawn.x; p.y=p.ty=spawn.y; p.z=p.tz=spawn.z; p.yaw=p.tyaw=spawn.yaw;
}
/* 非常階段の経路。上りは z>0 側、下りは z<0 側から入る */
function stairPath(from,to){
  const wp=[{x:-12.6,z:0},{x:-15.4,z:0}];
  let L=from;
  let guard=0;
  while(L!==to && guard++<8){
    const up=to>L;
    const zA=up? 1.55:-1.55, zB=up? -1.55:1.55;
    wp.push({x:-15.4,z:zA},{x:-21.9,z:zA},{x:-21.9,z:zB},{x:-15.4,z:zB});
    L+=up?4:-4;
  }
  wp.push({x:-15.4,z:0},{x:-12.6,z:0});
  return wp;
}
function moveNPC(a,vx,vz){
  const step=(nx,nz)=>{
    if(nx>13.9&&Math.abs(nz)<3.05) return null;        // エレベーターには乗らない
    if(nz>2.6&&Math.abs(nx)<4.6&&Math.abs(a.y)<1) return null;  // 1Fの設備室（梯子）は避ける
    const g=surfaceAt(nx,nz,a.y);
    if(Math.abs(g-a.y)>0.55) return null;
    if(blocked(nx,nz,NPC_R,g)) return null;
    return g;
  };
  if(vx!==0){ const g=step(a.pos.x+vx,a.pos.z); if(g!==null){ a.pos.x+=vx; a.y=g; } }
  if(vz!==0){ const g=step(a.pos.x,a.pos.z+vz); if(g!==null){ a.pos.z+=vz; a.y=g; } }
  a.pos.y=a.y;
}
function npcOpenDoors(a){
  for(const d of doors){
    if(d.open||d.locked) continue;
    if(Math.abs(d.pos.y-1-a.y)>1.6) continue;
    if(Math.hypot(d.pos.x-a.pos.x,d.pos.z-a.pos.z)<1.9) act({t:"door",i:d.idx});
  }
}
function npcDecide(slot){
  const a=P[slot].ai;
  a.think=1.0+Math.random()*1.6;
  if(a.pos.x<-14.2){                       // 階段の中なら、まずフロアへ出る
    a.path=[{x:-15.4,z:0},{x:-12.6,z:0}]; a.dest=null; return;
  }
  const here=levelOf(a.y);
  if(Math.random()<0.55){                  // 生存者のいるフロアへ移動
    const cands=[];
    for(let i=0;i<MAXP;i++){
      if(i===slot) continue;
      const q=P[i]; if(!q.used||!q.alive) continue;
      const L=levelOf(posOf(i).y);
      if(L!==here&&!floorClosed(Math.round(L/FH))) cands.push(L);
    }
    const pool=LEVELS.filter(L=>!floorClosed(Math.round(L/FH)));
    const to=cands.length? cands[Math.floor(Math.random()*cands.length)]
                         : pool[Math.floor(Math.random()*pool.length)];
    if(to!==here){ a.path=stairPath(here,to); a.dest=null; return; }
  }
  a.dest={x:-12+Math.random()*24, z:-7.5+Math.random()*15};   // フロア内をうろつく
  a.path=[];
}
function updateNPC(slot,dt){
  const p=P[slot], a=p.ai;
  if(!p.used||!p.alive||!a) return;
  if(p.down>0){ p.mov=0; return; }        // 倒れている間は動かない
  a.cool-=dt; a.think-=dt;
  npcOpenDoors(a);

  /* 同じフロアで見えている相手を探す */
  let tgt=-1, td=1e9;
  const eye=new THREE.Vector3(a.pos.x,a.y+1.45,a.pos.z), tv=new THREE.Vector3();
  for(let i=0;i<MAXP;i++){
    if(i===slot) continue;
    const q=P[i]; if(!q.used||!q.alive||q.down>0) continue;
    if(i===net.mySlot&&down.active) continue;
    const tp=posOf(i);
    if(Math.abs(tp.y-a.y)>1.6) continue;
    const d=Math.hypot(tp.x-a.pos.x,tp.z-a.pos.z);
    if(d>NPC_RANGE||d>=td) continue;
    tv.set(tp.x,tp.y+1.35,tp.z);
    if(!losClear(eye,tv)) continue;
    tgt=i; td=d;
  }

  let mx=0,mz=0;
  if(tgt>=0){
    const tp=posOf(tgt);
    const dx=tp.x-a.pos.x, dz=tp.z-a.pos.z, d=Math.hypot(dx,dz)||1;
    a.yaw=Math.atan2(-dx,-dz);
    a.path.length=0; a.dest=null; a.think=0.6;
    if(d>7.0){ mx=dx/d; mz=dz/d; }                 // 近づく
    else if(d<3.2){ mx=-dx/d; mz=-dz/d; }          // 離れる
    else { mx=-dz/d; mz=dx/d; }                    // 横に回り込む
    if(a.cool<=0){
      a.cool=1.3+Math.random()*1.0;
      remoteFire(slot,0);
      if(Math.random()<npcHitChance(td)) act({t:"hit",target:tgt,head:Math.random()<0.12,w:0,by:slot});
    }
  }else{
    if(!a.path.length && !a.dest) npcDecide(slot);
    else if(a.think<=0 && !a.path.length) npcDecide(slot);
    const w=a.path.length?a.path[0]:a.dest;
    if(w){
      const dx=w.x-a.pos.x, dz=w.z-a.pos.z, d=Math.hypot(dx,dz);
      if(d<0.9){
        if(a.path.length) a.path.shift(); else { a.dest=null; a.think=0; }
      }else{
        mx=dx/d; mz=dz/d;
        a.yaw=Math.atan2(-mx,-mz);
      }
    }
  }

  const want=Math.hypot(mx,mz)>0.01;
  if(want) moveNPC(a,mx*NPC_SPEED*dt,mz*NPC_SPEED*dt);

  /* はまり込み対策 */
  const moved=Math.hypot(a.pos.x-a.lx,a.pos.z-a.lz);
  a.lx=a.pos.x; a.lz=a.pos.z;
  if(want&&moved<0.004){ a.stuck+=dt; } else a.stuck=Math.max(0,a.stuck-dt*2);
  if(a.stuck>1.1){ a.stuck=0; a.path=[]; a.dest=null; a.think=0; npcDecide(slot); }

  p.tx=a.pos.x; p.ty=a.y; p.tz=a.pos.z; p.tyaw=a.yaw; p.mov=want?1:0;
}
function updateNPCs(dt){
  for(let i=0;i<MAXP;i++) if(P[i].npc) updateNPC(i,dt);
}
/* ============================================================
   同じフロアに2分以上とどまっている相手を全員に知らせる
   ============================================================ */
function updateCamp(dt){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive||p.down>0){ p.campT=0; p.campF=null; continue; }
    const fi=floorIndexOf(posOf(i).y);
    if(p.campF!==fi){ p.campF=fi; p.campT=0; p.campNext=CAMP_T; }
    p.campT=(p.campT||0)+dt;
    if(p.campT>=(p.campNext||CAMP_T)){
      p.campNext=p.campT+CAMP_REPEAT;
      const m={t:"camp",slot:i,f:fi};
      applyCamp(m);
      if(net.isHost&&net.on) bcast(m);
    }
  }
}
function applyCamp(m){
  if(m.slot===net.mySlot) return;      // 隠れている本人には出さない
  guide(floorLabelOf(m.f)+"に誰かが隠れている",5);
}

/* ============================================================
   鍵の設置（ホストが場所を決めて全員へ配信）
   ============================================================ */
let matchT=0, keysDone=false;
function roomSpot(fi,idx){
  const r=ROOMS[fi][idx];
  const x=(r.left?-7.0:7.0)+(Math.random()-0.5)*7.0;
  const z=(r.side==="N"? 5.9:-5.9)+(Math.random()-0.5)*3.0;
  return {x:x,y:fi*FH,z:z};
}
/* 各フロアの部屋から2つ選び、盾と回復薬をひとつずつ置く */
function buildItemList(){
  const out=[];
  if(mode==="easy") return out;      // Easyはアイテムなし
  for(const fi of [1,2,3,4]){
    const idx=[0,1,2,3];
    for(let i=idx.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1)); const t=idx[i]; idx[i]=idx[j]; idx[j]=t;
    }
    const a=roomSpot(fi,idx[0]), b=roomSpot(fi,idx[1]);
    out.push({k:"sh",id:"sh"+fi,x:a.x,y:a.y,z:a.z});
    out.push({k:"hp",id:"hp"+fi,x:b.x,y:b.y,z:b.z});
  }
  /* 屋上は部屋がないので、開けた場所から2か所選ぶ（開始位置とショットガンの湧き場は避ける） */
  if(mode==="easy") return out;        // Easyは屋上に置かない
  const rf=[[-9.5,4.5],[9.5,4.5],[-9.5,-6.0],[9.5,-6.0]];
  for(let i=rf.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1)); const t=rf[i]; rf[i]=rf[j]; rf[j]=t;
  }
  out.push({k:"sh",id:"shR",x:rf[0][0],y:ROOF_Y,z:rf[0][1]});
  out.push({k:"hp",id:"hpR",x:rf[1][0],y:ROOF_Y,z:rf[1][1]});
  return out;
}
function updateItemDrop(dt){
  if(keysDone) return;
  keysDone=true;
  const list=buildItemList();
  placeItems(list);
  if(net.isHost&&net.on) bcast({t:"items",a:list});
}

/* ============================================================
   リスポーン先は「倒れた瞬間」ではなく「復帰の直前」に決める。
   3秒のダウン中に相手が動くので、被弾時に決めた場所は当てにならない
   ============================================================ */
function updateRespawn(dt){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(p.respT==null||p.respT<=0) continue;
    p.respT-=dt;
    if(p.respT>0.35||p.respSent) continue;   // 復帰0.35秒前に確定して配る
    p.respSent=true;
    if(!p.used||!p.alive) continue;
    const sp=freeSpawnFor(i);
    p.pendSp=sp;
    if(i===net.mySlot&&SPAWNS[sp]) mySpawn=SPAWNS[sp];
    if(net.isHost&&net.on) bcast({t:"sp",slot:i,sp:sp});
  }
}

/* ============================================================
   エレベーターの電源。切っても、誰かが乗っている間は動かし続ける
   ============================================================ */
let evWanted=true;
function someoneInCar(){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive) continue;
    const q=posOf(i);
    if(q.x>13.6&&q.x<19.9&&Math.abs(q.z)<2.9&&Math.abs(q.y-elev.y)<1.2) return true;
  }
  return false;
}
function updateEvPower(dt){
  if(evWanted){
    if(!flags.power) flags.power=true;
  }else if(flags.power&&!someoneInCar()){
    flags.power=false;                 // 誰も乗っていないので、ここで扉が開かなくなる
  }
  refreshEvPanel();
}

/* ============================================================
   1Fの閉鎖（2分30秒で予告、3分で封鎖）
   ============================================================ */
/* 予告→閉鎖を1フロアずつ、下から順に。開始2分30秒から30秒おき。
   偶数番のイベントが予告、奇数番が閉鎖。最後（5F閉鎖）で屋上だけが残る */
function lockEventTime(i){
  if(mode==="team") return TEAM_LOCK_START+Math.floor(i/2)*TEAM_LOCK_GAP+(i%2)*LOCK_STEP;
  return LOCK_START+i*LOCK_STEP;
}
function sealFloor(f){
  for(const d of doors){
    if(d.name==="非常階段のドア"&&Math.abs(d.pos.y-(f*FH+1))<0.2){
      d.open=false; d.locked=true; d.keyId="__sealed__"; d.col.active=true;
    }
  }
  if(elev.floor===f&&elev.state!=="moving") elev.state="closing";
}
/* Normalは1Fから上へ、Teamは5Fから下へ閉じる */
function lockFloorOf(i){
  const k=Math.floor(i/2);
  return (mode==="team") ? (FLOORS-1-k) : k;
}
function applyLockWarn(f,sec){
  if(warnSet[f]||closedSet[f]) return;
  warnSet[f]=1;
  guide(f>=FLOORS ? ("あと"+(sec||LOCK_STEP)+"秒でエレベーターが閉鎖される。かごから出ろ")
                  : ("あと"+(sec||LOCK_STEP)+"秒で"+floorLabelOf(f)+"が閉鎖される。脱出しろ"),6);
  sfx("locked");
}
function applyLockClose(f){
  if(closedSet[f]) return;
  delete warnSet[f]; closedSet[f]=1;
  sealFloor(f);
  guide(f>=FLOORS ? "エレベーターは閉鎖された。中にいると助からない"
        : isFinalStage() ? (floorLabelOf(f)+"は閉鎖された。残るは屋上だけだ")
                         : (floorLabelOf(f)+"は閉鎖された。もう誰も入れない"),6);
  sfx("break");
  if(mode==="team"){        // 閉じたフロアのゾンビは消える
    for(const z of zombies.slice()){
      const zf=(z.y<-2)?0:floorIndexOf(z.y);
      if(zf===f) removeZombie(z);
    }
  }
}
function applyLockEvent(i){
  if(i<lockEv) return;
  lockEv=i+1;
  const f=lockFloorOf(i);
  if(i%2===0) applyLockWarn(f);
  else applyLockClose(f);
}
/* Team専用の閉鎖時計。フロアごとに独立して進む */
function updateTeamLock(dt){
  if(teamLockT[FLOORS-1]==null) teamLockT[FLOORS-1]=0;   // 5Fは開始と同時に動きだす
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive) continue;
    if(i!==net.mySlot&&!p.init) continue;
    const q=posOf(i);
    const inCar=(q.x>13.6&&q.x<19.9&&Math.abs(q.z)<2.9);
    const fi=floorIndexOf(inCar?elev.y:q.y);
    if(fi>=0&&fi<FLOORS&&teamLockT[fi]==null) teamLockT[fi]=0;   // 立ち入りで始動
  }
  if(teamLockT[FLOORS]==null&&elev.floor===FLOORS&&elev.state==="open") teamLockT[FLOORS]=0;
  for(let f=0;f<=FLOORS;f++){
    if(teamLockT[f]==null||closedSet[f]) continue;
    teamLockT[f]+=dt;
    const dur=TEAM_LOCK_DUR[f];
    if(!teamWarned[f]&&teamLockT[f]>=dur-TEAM_WARN_LEAD){
      teamWarned[f]=1;
      applyLockWarn(f,TEAM_WARN_LEAD);
      if(net.isHost&&net.on) bcast({t:"lockf",f:f,k:0});
    }
    if(teamLockT[f]>=dur){
      applyLockClose(f);
      if(net.isHost&&net.on) bcast({t:"lockf",f:f,k:1});
    }
  }
}
function updateLockdown(dt){
  lockT+=dt;
  while(lockEv<FLOORS*2&&lockT>=lockEventTime(lockEv)){
    const i=lockEv;
    applyLockEvent(i);
    if(net.isHost&&net.on) bcast({t:"lock",ev:i});
  }
  if(closedCount()===0) return;
  updateSealedDamage(dt);
}
/* 閉鎖済みのフロアに残っている者を弾く（NormalもTeamも共通） */
function updateSealedDamage(dt){
  if(closedCount()===0) return;
  lockCheck-=dt;
  if(lockCheck>0) return;
  lockCheck=0.35;
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive||p.down>0) continue;
    const q=posOf(i);
    if(inSealedZone(q.x,q.y,q.z))
      hostHandle({t:"hit",target:i,head:true,w:0,by:i},net.mySlot);
  }
}

/* --- NPC戦の開始 --- */
function startSolo(n){
  const idx=SPAWNS.map((v,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=idx[i];idx[i]=idx[j];idx[j]=t; }
  const slots=[0]; for(let i=1;i<=n;i++) slots.push(i);
  const assign={}; slots.forEach((s,k)=>{ assign[s]=idx[k]; });
  net.on=false; net.isHost=true; net.mySlot=0; net.started=true;
  beginMatch(assign,slots,"normal");   // NPC戦は常にNormal
  for(let i=1;i<=n;i++) npcInit(i,SPAWNS[assign[i]]);
  refreshHud();
}

function makeZombie(x,floorY,zz,kind,id,hp){
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
    const a=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.64,0.14),MAT.zombieSkin); a.position.y=-0.32; pa.add(a);
    pa.rotation.x=-1.02; arms.push(pa);   // 前に出しすぎると壁を抜ける
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
    losT:Math.random(), seen:false, stuck:0, side:0, wanderT:0,
    kind:kind||"norm", id:id, hp:hp||2, hpMax:hp||2, tx:x, tz:zz, tdir:0, hurtT:0, atk:0
  };
  zombies.push(z);
  if(ZMODEL.ready) attachModel(z);
  return z;
}
/* ===== ゾンビの3Dモデル（GLB埋め込み） ===== */
const ZMODEL={ ready:false, scene:null, clip:null, walk:null, scale:1, yOff:0, yaw:0, axes:null, base:null };
// 通報後、2F/3F/屋上の個体は歩行クリップに切り替わり、動きも速くなる
const ALERT_SPEED=1.85, ALERT_SIGHT=26, ALERT_LOSE=11.0, ALERT_TURN=5.0;
function zombieAlert(z){ return z.kind==="alert"; }   // 1F/2F/屋上は通報後タイプ
const USE_CLIP_ANIM=false;   // true にすると同梱アニメを再生。false は従来どおりの手続き動作
const POSE_T=0.6;            // 手続き動作の土台にする静止ポーズの時刻（秒）
const BONE_KEYS={LUL:"LeftUpLeg",RUL:"RightUpLeg",LA:"LeftArm",RA:"RightArm"};
// 同梱クリップはアイドル1本（約6.1秒）
const CLIP={ LOOP_A:0.05, LOOP_B:6.0 };
function toLambertSkin(mat){
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
        o.material=Array.isArray(o.material)?o.material.map(toLambert):toLambertSkin(o.material);
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
  FX.zombieVariant(inst,z.id);
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


/* ============================================================
   Teamモード
   全員で5Fから降りながらゾンビを狩り、屋上のボスを倒す。
   プレイヤー同士の弾は当たらず、討伐数で順位が決まる
   ============================================================ */
const zombies=[];
let boss=null, bossHpMax=99;
const TEAM_START={x:0,y:ROOF_Y,z:0,yaw:Math.PI/2,fl:"屋上"};   // 屋上の中央。塔屋(-x)を向いて開始
/* 呼び出しボタンが使えるフロア（制御スイッチを押すと開く） */
const teamCallOk={0:false,2:false,4:false};
const teamSeen={};
const TEAM_MSG={
  f4:"エレベーターの呼び出しボタンが使えない。このフロアに制御スイッチがあるはずだ",
  f2:"エレベーターの呼び出しボタンが使えない。このフロアに制御スイッチがあるはずだ",
  f0:"地下室にエレベーターの制御スイッチがあるはずだ",
  e4:"エレベーターは4Fまでしか動かないようだ。全員が揃ってからいこう",
  e2:"エレベーターは2Fまでしか動かないようだ。全員が揃ってからいこう"
};
/* フロア番号 → 出現数と種別（下の階ほど多く、屋上が最多） */
const TEAM_ZCOUNT={0:22, 1:20, 2:18, 3:16, 4:14, 5:24, b:14};
const TEAM_ZKIND_B="alert";
const CORRIDOR_RATIO=0.7;      // 廊下7 : 部屋3
const ZSEP=0.95;               // ゾンビ同士がこれ以上近づかない
const ZFRONT=0.34;             // 腕が壁を抜けないように、前方この距離を空ける
const AGGRO_ON_N=7.0;          // 近づかれて初めて追い始める距離（通常）
const AGGRO_ON_A=9.0;          //                         （通報後）
const AGGRO_OFF=22.0;          // ここまで離れないと追跡をやめない
const AGGRO_MIN=8.0;           // 一度追い始めたら最低これだけは追い続ける（秒）
const LADDER={x:0,z:6.6}, LADDER_R=3.6;   // 地下の梯子の真下。ゾンビを寄せない
const TEAM_ZKIND ={0:"alert", 1:"alert", 2:"norm", 3:"norm", 4:"norm", 5:"alert"};
/* エレベーターで行ける経路。5F→4F、3F→2F、1F→屋上 */
const TEAM_ROUTE={4:3, 2:1, 0:5};
function teamBoardFloor(fi){ return TEAM_ROUTE[fi]!=null; }

function zombieHp(kind){ return kind==="alert"?3:2; }
let zNextId=1;
function zombieSpot(fi){
  if(fi==="b"){                            // 地下（通路と奥の小部屋）
    if(Math.random()<0.75) return [(Math.random()-0.5)*1.6,-13.0+Math.random()*15.0];
    return [(Math.random()-0.5)*6.4,-19.4+Math.random()*4.6];
  }
  if(fi===5){                              // 屋上は部屋がないので広く散らす
    return [(Math.random()-0.5)*24,(Math.random()-0.5)*14];
  }
  if(Math.random()<CORRIDOR_RATIO){        // 廊下
    return [(Math.random()-0.5)*25,(Math.random()-0.5)*3.6];
  }
  const sx=Math.random()<0.5?-1:1, sz=Math.random()<0.5?-1:1;   // 部屋
  return [sx*(1.2+Math.random()*11.5), sz*(3.3+Math.random()*4.9)];
}
function spawnZombieList(n,floors){
  const out=[];
  const mul=0.75+0.25*Math.max(1,n)/2;
  for(const fi of floors){
    const c=Math.max(1,Math.round(TEAM_ZCOUNT[fi]*mul));
    const y=(fi==="b")?BASE_Y:fi*FH;
    const kind=(fi==="b")?TEAM_ZKIND_B:TEAM_ZKIND[fi];
    for(let k=0;k<c;k++){
      const s=zombieSpot(fi);
      out.push([zNextId++,kind,Math.round(s[0]*10)/10,y,Math.round(s[1]*10)/10]);
    }
  }
  return out;
}
function placeZombies(list){
  for(const a of list){
    const z=makeZombie(a[2],a[3],a[4],a[1],a[0],zombieHp(a[1]));
    z.tx=z.pos.x; z.tz=z.pos.z;
  }
}
/* 屋上のボスは専用モデル（enemy.glb）。読み込めなければゾンビの拡大表示のまま */
const BOSSMODEL={ready:false,scene:null,clip:null,base:1,foot:0};
const BOSS_H=5.0;                  // 全高(m)
function loadBossModel(){
  const buf=window.ASSETS&&ASSETS.boss;
  if(!buf||!THREE.GLTFLoader) return;
  new THREE.GLTFLoader().parse(buf,"",(gltf)=>{
    const root=gltf.scene;
    root.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){
      o.material=Array.isArray(o.material)?o.material.map(toLambertSkin):toLambertSkin(o.material);
      o.frustumCulled=false;
    }});
    root.updateMatrixWorld(true);
    const b=new THREE.Box3().setFromObject(root);
    const size=new THREE.Vector3().subVectors(b.max,b.min);
    BOSSMODEL.base=BOSS_H/Math.max(0.001,size.y);
    BOSSMODEL.foot=-b.min.y*BOSSMODEL.base;      // 足元を原点に合わせる
    BOSSMODEL.scene=root;
    BOSSMODEL.clip=(gltf.animations&&gltf.animations[0])||null;
    BOSSMODEL.ready=true;
    if(boss) applyBossModel(boss);
  },()=>{});
}
function applyBossModel(z){
  if(!BOSSMODEL.ready||z.bossModel) return;
  for(const c of z.g.children.slice()) z.g.remove(c);   // ゾンビの見た目を捨てる
  z.g.scale.set(1,1,1);
  const inst=BOSSMODEL.scene;
  inst.scale.setScalar(BOSSMODEL.base);
  inst.position.y=BOSSMODEL.foot;
  z.g.add(inst);
  z.bossModel=inst;
  if(BOSSMODEL.clip){
    z.mixer=new THREE.AnimationMixer(inst);
    z.mixer.clipAction(BOSSMODEL.clip).play();
  }
}
function spawnBoss(){
  if(boss) return;
  boss=makeZombie(0,ROOF_Y,-4.0,"alert",9999,bossHpMax);
  boss.boss=true; boss.hpMax=bossHpMax;
  boss.g.scale.set(3.0,3.0,3.0);
  applyBossModel(boss);
  zombies.splice(zombies.indexOf(boss),1);   // 通常のゾンビ配列とは別に扱う
}
function findZombie(id){
  if(boss&&boss.id===id) return boss;
  for(const z of zombies) if(z.id===id) return z;
  return null;
}
function removeZombie(z){
  z.dead=true;
  if(z.g&&z.g.parent) scene.remove(z.g);
  const i=zombies.indexOf(z); if(i>=0) zombies.splice(i,1);
  if(z===boss) boss=null;
}

/* --- ゾンビの行動（ホストだけが動かす） --- */
/* 前方が壁なら、腕が刺さらない位置まで下がる */
function frontBlocked(z,far){
  const sx=Math.sin(z.dir), sz=Math.cos(z.dir);
  const probes=far?[0.60,0.95]:[0.45];
  for(const d of probes)
    if(blocked(z.pos.x+sx*d, z.pos.z+sz*d, 0.24, z.y)) return true;
  return false;
}
/* 地下の梯子の真下からは押し出す（降りた瞬間に殴られないように） */
function keepOutLadder(z){
  if(z.y>-2) return;
  const dx=z.pos.x-LADDER.x, dz=z.pos.z-LADDER.z;
  const d=Math.hypot(dx,dz);
  if(d>=LADDER_R) return;
  const k=(LADDER_R-d)/(d||1);
  moveZombie(z,dx*k,dz*k);
}
function moveZombieSafe(z,vx,vz){
  const ox=z.pos.x, oz=z.pos.z;
  moveZombie(z,vx,vz);
  if(frontBlocked(z,z.farGuard)){ z.pos.x=ox; z.pos.z=oz; }
  keepOutLadder(z);
}
/* ゾンビ同士を重ならせない（同じ高さのものだけ見る） */
function separateZombies(){
  const bk={};
  for(const z of zombies){
    const k=Math.round(z.y/2);
    (bk[k]=bk[k]||[]).push(z);
  }
  for(const k in bk){
    const a=bk[k];
    for(let i=0;i<a.length;i++){
      for(let j=i+1;j<a.length;j++){
        const A=a[i],B=a[j];
        let dx=B.pos.x-A.pos.x, dz=B.pos.z-A.pos.z;
        let d=Math.hypot(dx,dz);
        if(d>=ZSEP) continue;
        if(d<1e-3){ dx=Math.random()-0.5; dz=Math.random()-0.5; d=Math.hypot(dx,dz)||1; }
        const push=(ZSEP-d)*0.5;
        dx/=d; dz/=d;
        moveZombie(A,-dx*push,-dz*push);
        moveZombie(B, dx*push, dz*push);
      }
    }
  }
  if(boss){                                  // ボスの周りはさらに広く空ける
    for(const z of zombies){
      if(Math.abs(z.y-boss.y)>2) continue;
      let dx=z.pos.x-boss.pos.x, dz=z.pos.z-boss.pos.z;
      let d=Math.hypot(dx,dz);
      if(d>=2.2) continue;
      if(d<1e-3){ dx=1; dz=0; d=1; }
      moveZombie(z,(dx/d)*(2.2-d),(dz/d)*(2.2-d));
    }
  }
}
/* 壁に向かって突っ立っている個体を、腕が刺さらない位置・向きに直す */
function relieveFront(){
  for(const z of zombies){
    if(!frontBlocked(z,z.farGuard)) continue;
    const ox=z.pos.x, oz=z.pos.z;
    moveZombie(z,-Math.sin(z.dir)*0.08,-Math.cos(z.dir)*0.08);
    if(z.pos.x===ox&&z.pos.z===oz&&z.state!=="chase"){
      z.dir+=1.9; z.wanderT=1.2+Math.random()*2.0;   // 下がれないなら向きを変える
    }
  }
}
const _zeye=new THREE.Vector3(), _zto=new THREE.Vector3();
function sfx0(z,name){          // 近くの個体だけ鳴らす
  if(Math.abs(z.y-player.pos.y)<2.4&&
     Math.hypot(z.pos.x-player.pos.x,z.pos.z-player.pos.z)<18) sfx(name);
}
function nearestPlayerTo(x,y,z){
  let best=null,bd=1e9;
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive||p.down>0) continue;
    if(i!==net.mySlot&&!p.init) continue;      // 座標が届いていない相手は狙わない
    const q=posOf(i);
    if(Math.abs(q.y-y)>2.4) continue;
    const d=Math.hypot(q.x-x,q.z-z);
    if(d<bd){ bd=d; best={slot:i,pos:q,d:d}; }
  }
  return best;
}
function updateZombiesTeam(dt){
  const all=boss?zombies.concat([boss]):zombies;
  for(const z of all){
    z.t+=dt;
    if(z.hurtT>0) z.hurtT-=dt;
    if(z.atk>0) z.atk-=dt;
    const tgt=nearestPlayerTo(z.pos.x,z.y,z.pos.z);
    let speed=0,tx=0,tz=0;
    /* 近づかれて初めて追い始め、一度始めたらしつこく追う */
    if(z.chaseT>0) z.chaseT-=dt;
    let chase=false;
    if(tgt){
      if(z.state==="chase"){
        chase=(tgt.d<AGGRO_OFF)||z.chaseT>0;
      }else{
        const on=zombieAlert(z)?AGGRO_ON_A:AGGRO_ON_N;
        if(tgt.d<on){
          _zeye.set(z.pos.x,z.y+1.35,z.pos.z);
          _zto.set(tgt.pos.x,tgt.pos.y+1.2,tgt.pos.z);
          chase=(tgt.d<3.0)||losClear(_zeye,_zto);   // 見えるか、すぐ近くで気配を感じたら
        }
      }
    }
    if(chase){
      if(z.state!=="chase") sfx0(z,"groan");
      z.state="chase"; z.chaseT=Math.max(z.chaseT,AGGRO_MIN);
      tx=tgt.pos.x-z.pos.x; tz=tgt.pos.z-z.pos.z;
      speed=z.boss?1.35:(zombieAlert(z)?ALERT_SPEED:1.15);
      if(z.side!==0){ const ox=tx,oz=tz; tx+=-oz*z.side*1.2; tz+=ox*z.side*1.2; }
    }else{
      z.state="idle"; z.chaseT=0;
      z.wanderT-=dt;
      if(z.wanderT<=0){ z.wanderT=2.5+Math.random()*3.5; z.dir=Math.random()*Math.PI*2; }
      const hx=z.home.x-z.pos.x, hz=z.home.z-z.pos.z;
      if(Math.hypot(hx,hz)>9) z.dir=Math.atan2(hx,hz);
      speed=zombieAlert(z)?0.75:0.45; tx=Math.sin(z.dir); tz=Math.cos(z.dir);
    }
    z.farGuard=!(tgt&&tgt.d<1.6);      // 相手が目の前のときだけ前方の余裕を詰める
    const len=Math.hypot(tx,tz)||1;
    const before=z.pos.x+z.pos.z;
    moveZombieSafe(z,tx/len*speed*dt,tz/len*speed*dt);
    if(frontBlocked(z,z.farGuard)) moveZombie(z,-Math.sin(z.dir)*0.9*dt,-Math.cos(z.dir)*0.9*dt);
    if(z.state==="chase"){
      if(Math.abs(z.pos.x+z.pos.z-before)<0.004){
        z.stuck+=dt; if(z.stuck>0.5){ z.side=Math.random()<0.5?-1:1; z.stuck=0; }
      }else{ z.stuck=Math.max(0,z.stuck-dt*0.6); if(z.stuck<=0) z.side=0; }
    }
    if(speed>0.05){
      const want=Math.atan2(tx,tz);
      let diff=want-z.dir;
      while(diff>Math.PI)diff-=Math.PI*2;
      while(diff<-Math.PI)diff+=Math.PI*2;
      z.dir+=diff*Math.min(1,dt*(zombieAlert(z)?ALERT_TURN:3.0));
    }
    /* 接触したら撃たれたのと同じ扱い（盾は正面なら効く） */
    if(tgt&&z.atk<=0&&tgt.d<(z.boss?1.9:0.75)){
      z.atk=1.5;
      hostHandle({t:"hit",target:tgt.slot,head:false,w:0,by:tgt.slot},net.mySlot);
    }
  }
  separateZombies();
  relieveFront();
}
/* --- 見た目の更新（全員が毎フレーム動かす） --- */
function drawZombies(dt){
  const all=boss?zombies.concat([boss]):zombies;
  for(const z of all){
    if(!net.isHost&&net.on){          // ゲストは受信値へ寄せる
      const k=Math.min(1,dt*10);
      z.pos.x+=(z.tx-z.pos.x)*k; z.pos.z+=(z.tz-z.pos.z)*k;
      let d=z.tdir-z.dir;
      while(d>Math.PI)d-=Math.PI*2;
      while(d<-Math.PI)d+=Math.PI*2;
      z.dir+=d*k;
      z.t+=dt;
    }
    z.g.position.set(z.pos.x,z.y,z.pos.z);
    z.g.rotation.y=z.dir;
    if(z.mixer){ z.mixer.update(dt*(z.state==="chase"?1.15:0.7)); }
    z.g.rotation.z=z.hurtT>0?Math.sin(z.t*22)*0.14:0;
    if(z.an){ FX.zombieAnim(z,dt); }
    else if(z.model){
      const near=Math.abs(z.y-player.pos.y)<2.4&&
                 Math.hypot(z.pos.x-player.pos.x,z.pos.z-player.pos.z)<34;
      if(near){
        if(z.wAction&&zombieAlert(z)){
          const d=ZMODEL.walk.duration;
          z.wPhase=(z.wPhase+dt*(z.state==="chase"?1.35:0.75))%d;
          z.wAction.time=z.wPhase; z.wMixer.update(0);
        }else if(z.action){
          const span=CLIP.LOOP_B-CLIP.LOOP_A;
          z.phase=(z.phase+dt*(z.state==="chase"?1.25:0.72))%span;
          poseZombie(z,CLIP.LOOP_A+z.phase);
        }else if(z.bones) animateModelProc(z);
      }
    }else{
      const w=z.state==="chase"?7.0:3.2, amp=z.state==="chase"?0.62:0.3;
      z.legs[0].rotation.x=Math.sin(z.t*w)*amp;
      z.legs[1].rotation.x=-Math.sin(z.t*w)*amp;
      z.arms[0].rotation.x=-1.35+Math.sin(z.t*w+1)*0.16;
      z.arms[1].rotation.x=-1.35-Math.sin(z.t*w+1)*0.16;
    }
  }
}
/* --- 同期 --- */
let zsT=0;
function broadcastZombies(dt){
  zsT-=dt;
  if(zsT>0) return;
  zsT=0.125;
  const a=[];
  for(const z of zombies) a.push([z.id,Math.round(z.pos.x*20)/20,Math.round(z.pos.z*20)/20,
                                  Math.round(z.dir*100)/100,z.state==="chase"?1:0]);
  if(boss) a.push([boss.id,Math.round(boss.pos.x*20)/20,Math.round(boss.pos.z*20)/20,
                   Math.round(boss.dir*100)/100,boss.state==="chase"?1:0]);
  bcast({t:"zs",a:a});
}
function applyZs(list){
  for(const q of list){
    const z=findZombie(q[0]);
    if(!z) continue;
    z.tx=q[1]; z.tz=q[2]; z.tdir=q[3]; z.state=q[4]?"chase":"idle";
  }
}
function applyZdie(id,by){
  const z=findZombie(id);
  if(!z) return;
  const wasBoss=(z===boss);
  FX.zombieDown(z,by,wasBoss);
  if(!FX.zombieDie(z)) removeZombie(z);
  sfx("zdown");
  if(!wasBoss&&by!=null&&P[by]){
    P[by].kills=(P[by].kills||0)+1;
    if(by===net.mySlot) guide("討伐 "+P[by].kills,1.2);
  }
  if(wasBoss) guide("ボスを倒した",5);
  refreshHud();
}
/* --- 撃たれたゾンビ（ホストの裁定） --- */
function hostZombieHit(id,dmg,from){
  const z=findZombie(id);
  if(!z||z.dead) return;
  z.hp-=dmg; z.hurtT=0.25;
  bcast({t:"zhurt",id:id});
  if(z===boss) bcast({t:"bhp",hp:Math.max(0,z.hp)});
  if(z.hp<=0){
    const wasBoss=(z===boss);
    applyZdie(id,wasBoss?null:from);
    bcast({t:"zdie",id:id,by:wasBoss?null:from});
    if(wasBoss) teamFinish("boss");
  }
}
/* --- 決着と順位 --- */
function teamRanking(){
  const r=[];
  for(let i=0;i<MAXP;i++) if(P[i].used) r.push({slot:i,kills:P[i].kills||0});
  r.sort((a,b)=>b.kills-a.kills);
  return r;
}
function teamFinish(reason){
  const out={t:"tend",reason:reason,k:{}};
  for(let i=0;i<MAXP;i++) if(P[i].used) out.k[i]=P[i].kills||0;
  applyTeamEnd(out);
  if(net.isHost&&net.on) bcast(out);
}
function applyTeamEnd(m){
  if(finished) return;
  for(const i in m.k) if(P[i]) P[i].kills=m.k[i];
  finished=true;
  document.exitPointerLock&&document.exitPointerLock();
  const r=teamRanking();
  winTitle.textContent=(m.reason==="boss")?"BOSS DOWN":"GAME OVER";
  winTitle.style.color=(m.reason==="boss")?"#e8c23a":"#a3271f";
  let html=(m.reason==="boss")?"ボスを倒した。<br><br>":"全員が倒れた。<br><br>";
  r.forEach((e,i)=>{
    html+='<div style="letter-spacing:.14em">'+(i+1)+'位　<b style="color:'+SLOT_CSS[e.slot]+'">'+
      SLOT_NAME[e.slot]+'</b>'+(e.slot===net.mySlot?"（あなた）":"")+'　討伐 '+e.kills+'</div>';
  });
  winText.innerHTML=html;
  winEl.style.display="flex";
  FX.result();
}
/* --- Teamのリスポーン先（味方が集まっているフロア） --- */
function teamSpawnIndex(slot){
  /* 倒れたその場のフロアで復帰する。地下なら地下（梯子の下は安全地帯） */
  if(slot!=null&&P[slot]){
    const q=posOf(slot);
    if(q.y<-2&&!floorClosed(0)) return SPAWN_BASE;
    const fi=floorIndexOf(q.y);
    if(fi>=0&&!floorClosed(fi)) return fi;
  }
  return teamFallbackIndex();
}
function teamFallbackIndex(){
  const c={};
  let best=-1,bn=-1;
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive) continue;
    const fi=floorIndexOf(posOf(i).y);
    if(fi<0||floorClosed(fi)) continue;
    c[fi]=(c[fi]||0)+1;
    if(c[fi]>bn){ bn=c[fi]; best=fi; }
  }
  if(best<0){ for(let fi=FLOORS;fi>=0;fi--) if(!floorClosed(fi)){ best=fi; break; } }
  return Math.max(0,Math.min(SPAWNS.length-1,best));
}
/* --- エレベーター（全員が乗るまで動かない） --- */
function everyoneAboard(){
  let n=0;
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive) continue;
    const q=posOf(i);
    if(q.x>13.6&&q.x<19.9&&Math.abs(q.z)<2.9&&Math.abs(q.y-elev.y)<1.4) n++;
    else return false;
  }
  return n>0;
}
function teamElevRequest(fi,isCall){
  if(isCall){
    if(!teamBoardFloor(fi)) return false;          // 乗り場は5F・3F・1Fだけ
    return !!teamCallOk[fi];                       // 制御スイッチを押すまで呼べない
  }
  if(TEAM_ROUTE[elev.floor]!==fi){                 // 決められた行き先だけ
    return false;
  }
  if(!everyoneAboard()){
    const g={t:"gmsg",s:"全員が乗り込むまで動かない"};
    applyGmsg(g); if(net.isHost&&net.on) bcast(g);
    return false;
  }
  return true;
}
function applyGmsg(m){ guide(m.s,3); }
/* 1Fから屋上へ向かうエレベーターが動き出したら、緊迫曲に切り替える */
let bossBgmOn=false, bossBgmVol=0;
function updateBossBgm(dt){
  if(!bgmBossEl) return;
  if(mode==="team"&&!bossBgmOn&&started&&
     elev.target===EV_STOPS-1&&elev.y<ROOF_Y-0.5&&
     (elev.state==="closing"||elev.state==="moving")){
    bossBgmOn=true;
    try{ bgmBossEl.volume=0; bgmBossEl.currentTime=0;
      const p=bgmBossEl.play(); if(p&&p.catch) p.catch(()=>{}); }catch(e){}
  }
  const t=(bossBgmOn&&!finished)?0.45:0;
  bossBgmVol+=(t-bossBgmVol)*Math.min(1,dt*(t>bossBgmVol?1.6:1.2));
  if(bossBgmVol<0.01&&t===0){
    bossBgmVol=0;
    if(!bgmBossEl.paused){ try{ bgmBossEl.pause(); }catch(e){} }
  }
  try{ bgmBossEl.volume=Math.max(0,Math.min(1,bossBgmVol)); }catch(e){}
}

/* ---- 倒れる / 助け起こす ---- */
function applyTdown(m){
  const p=P[m.slot]; if(!p) return;
  FX.teamDown(m);
  p.dn=TEAM_DOWN_T; p.down=TEAM_DOWN_T; p.mov=0;
  p.dkx=m.kx||0; p.dkz=m.kz||1;
  if(m.slot===net.mySlot){ sfx("hit"); startDown(p.dkx,p.dkz,TEAM_DOWN_T); }
  guide(SLOT_NAME[m.slot]+"が倒れた。回復薬を運べ",4);
  refreshHud();
}
function applyTrev(m){
  const p=P[m.slot]; if(!p) return;
  p.dn=0; p.down=0;
  if(P[m.by]) P[m.by].pot=0;
  if(m.by===net.mySlot){ hasPot=false; sfx("pickup"); }
  if(m.slot!==net.mySlot) guide(SLOT_NAME[m.slot]+"が復活した",3);
  refreshHud();
}
function applyTdead(m){
  const p=P[m.slot]; if(!p) return;
  p.dn=0; p.down=0; p.alive=false;
  if(m.slot===net.mySlot) eliminate();
  else guide(SLOT_NAME[m.slot]+"は力尽きた",4);
  refreshHud();
}
function applyTpot(m){
  const p=P[m.slot]; if(!p) return;
  p.pot=m.on?1:0;
  if(m.slot===net.mySlot){ hasPot=!!m.on; if(m.on) sfx("pickup"); }
  refreshHud();
}
/* ホストが倒れている時間を数え、力尽きたら脱落させる */
function updateTeamDown(dt){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive||!p.dn) continue;
    p.dn-=dt;
    p.down=Math.max(0.01,p.dn);
    if(p.dn<=0){
      p.dn=0;
      const m={t:"tdead",slot:i};
      applyTdead(m); if(net.isHost&&net.on) bcast(m);
      checkEnd();
    }
  }
}
/* 回復薬を持った仲間が倒れている人に触れたら復活 */
function updateRevive(){
  for(let i=0;i<MAXP;i++){
    const a=P[i];
    if(!a.used||!a.alive||a.dn||!a.pot) continue;
    if(i!==net.mySlot&&!a.init) continue;
    const qa=posOf(i);
    for(let j=0;j<MAXP;j++){
      if(j===i) continue;
      const b=P[j];
      if(!b.used||!b.alive||!b.dn) continue;
      const qb=posOf(j);
      if(Math.abs(qa.y-qb.y)>2.0) continue;
      if(Math.hypot(qa.x-qb.x,qa.z-qb.z)>REVIVE_R) continue;
      const m={t:"trev",slot:j,by:i};
      applyTrev(m); if(net.isHost&&net.on) bcast(m);
      break;
    }
  }
}
/* 進行の合図。ホストが見つけて全員に配る */
function applyTmsg(k){
  if(teamSeen[k]) return;
  teamSeen[k]=1;
  guide(TEAM_MSG[k]||"",5);
  sfx("click");
}
function fireTmsg(k){
  if(teamSeen[k]) return;
  applyTmsg(k);
  if(net.isHost&&net.on) bcast({t:"tmsg",k:k});
}
function updateTeamGuides(){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(!p.used||!p.alive) continue;
    if(i!==net.mySlot&&!p.init) continue;   // まだ座標が届いていない相手は数えない
    const q=posOf(i);
    const inCar=(q.x>13.6&&q.x<19.9&&Math.abs(q.z)<2.9);
    const fi=floorIndexOf(inCar?elev.y:q.y);
    if(inCar){
      if(fi===4) fireTmsg("e4");
      if(fi===2) fireTmsg("e2");
    }else{
      if(fi===4) fireTmsg("f4");
      if(fi===2) fireTmsg("f2");
      if(fi===0) fireTmsg("f0");
    }
  }
}
/* 制御スイッチ */
function applyTsw(f){
  if(teamCallOk[f]) return;
  teamCallOk[f]=true;
  guide(f===0?"エレベーターが呼び出せるようになった。これでRFまでいけるはずだ"
             :"エレベーターが呼び出せるようになった",5);
  sfx("power");
}
/* Teamモードのときだけ、照明スイッチを制御スイッチに置き換える */
function setupTeamSwitches(on){
  const list=(lightSwitches||[]).concat(baseSwitch?[baseSwitch]:[]);
  for(const s of list){
    const isBase=(s===baseSwitch);
    const fi=isBase?0:Math.round(s.y/FH);
    const ctrl=on&&(isBase||fi===4||fi===2);
    if(isBase){
      const idx=interacts.indexOf(s.it);
      if(on&&idx<0) interacts.push(s.it);
      if(!on&&idx>=0) interacts.splice(idx,1);
      if(s.g) s.g.visible=on;
    }
    if(ctrl){
      s.it.label=()=> teamCallOk[fi]?null:"エレベーターの制御スイッチを入れる";
      s.it.use=()=>{ if(!teamCallOk[fi]) act({t:"tsw",f:fi}); };
    }else if(!isBase){
      s.it.label=()=> flags.lightsOn?"照明を消す":"照明を点ける";
      s.it.use=()=>{ act({t:"lights",on:!flags.lightsOn}); };
    }
  }
}
/* ボスの体力バー */
function refreshBoss(){
  if(!bossBar) return;
  const show=(mode==="team"&&boss&&!finished&&Math.abs(player.pos.y-ROOF_Y)<3);
  bossBar.style.display=show?"block":"none";
  if(show) bossFill.style.width=Math.max(0,boss.hp/boss.hpMax*100)+"%";
}


/* ============================================================
   試合の進行
   ============================================================ */
let mySpawn=SPAWNS[0];
/* モードは対人対戦だけで切り替わる。NPC戦は常にNormal */
function applyMode(m){
  mode=(m==="easy"||m==="hard"||m==="team")?m:"normal";
  LIVES=(mode==="hard")?1:3;
  for(const z of zombies.slice()) removeZombie(z);
  if(boss) removeZombie(boss);
  const easy=(mode==="easy");
  const noPanel=easy||(mode==="team");   // EasyとTeamは電源盤なし
  for(const pn of evPanels){
    if(pn.g) pn.g.visible=!noPanel;
    const i=interacts.indexOf(pn.it);
    if(noPanel){ if(i>=0) interacts.splice(i,1); }
    else if(i<0) interacts.push(pn.it);
  }
  /* Easyは非常階段と屋上の扉以外すべて封鎖する。部屋も1Fの設備室（＝地下への通路）も入れない */
  for(const d of doors){
    if(d.name==="非常階段のドア"||d.name==="屋上のドア") continue;
    if(easy){ d.open=false; d.locked=true; d.keyId="__sealed__"; d.col.active=true; }
    else if(d.keyId==="__sealed__"){ d.locked=false; d.keyId=null; }
  }
  /* Teamは非常階段の扉をすべて開錠し、4F-5F間と2F-3F間を壁で塞ぐ */
  const team=(mode==="team");
  if(teamWalls) for(const w of teamWalls){ w.mesh.visible=team; w.col.active=team; }
  setupTeamSwitches(team);
  for(const k in teamCallOk) teamCallOk[k]=false;
  for(const k in teamSeen) delete teamSeen[k];
  /* Easyは盾も回復薬もショットガンも使わない。
     腕前で差がつく要素を減らし、運の比重を上げるため */
  const k=keyReg["sg1"];
  if(k&&easy){
    if(k.g&&k.g.parent) scene.remove(k.g);
    const i=interacts.indexOf(k.it); if(i>=0) interacts.splice(i,1);
  }
}
function beginMatch(assign,slots,m){
  applyMode(m);
  net.started=true;
  for(let i=0;i<MAXP;i++){ const q=P[i];
    q.used=false; q.alive=false; q.lives=LIVES; q.init=false; q.safeUntil=0;
    q.npc=false; q.ai=null; q.down=0; q.w=0; q.pendSp=null; q.cr=0;
    q.campT=0; q.campF=null; q.campNext=CAMP_T; q.respT=0; q.respSent=false; q.sh=0; q.kills=0;
    q.dn=0; q.pot=0; }
  for(const s of slots){
    P[s].used=true; P[s].alive=true; P[s].lives=LIVES;
    /* 座標を配らないと (0,0,0)＝1F扱いのままになり、ゾンビに狙われたり
       救助の距離判定が壊れたりする */
    const sp=(mode==="team")?TEAM_START:(SPAWNS[assign[s]!=null?assign[s]:0]||SPAWNS[0]);
    P[s].x=P[s].tx=sp.x; P[s].y=P[s].ty=sp.y; P[s].z=P[s].tz=sp.z;
    P[s].yaw=P[s].tyaw=sp.yaw||0; P[s].init=true;
  }
  mySpawn=(mode==="team")?TEAM_START
                         :SPAWNS[assign[net.mySlot]!=null?assign[net.mySlot]:0];
  lives=LIVES; alive=true; finished=false; weapon=0; sgCool=0; setShield(0);
  pistolLock=0; bloomN=0; bloomT=0; hasPot=false;
  bossBgmOn=false; bossBgmVol=0;
  crouch=false; crouchT=0;
  matchT=0; keysDone=false; pendingEnd=null;
  evWanted=true; flags.power=true; refreshEvPanel();
  lockT=0; lockEv=0; lockCheck=0;
  for(const k in warnSet) delete warnSet[k];
  for(const k in teamLockT) delete teamLockT[k];
  for(const k in teamWarned) delete teamWarned[k];
  for(const k in closedSet) delete closedSet[k];
  if(lockvEl) lockvEl.style.display="none";
  setCross(6); crossEl.classList.remove("wide"); crossEl.classList.remove("cool");
  crossEl.style.display=""; crossWide=false; crossCool=false;
  down.active=false; dmgEl.style.opacity="0";
  player.pos.set(mySpawn.x,mySpawn.y,mySpawn.z);
  player.yaw=mySpawn.yaw; player.pitch=0; player.vy=0;
  P[net.mySlot].x=player.pos.x; P[net.mySlot].y=player.pos.y; P[net.mySlot].z=player.pos.z;
  lobbyEl.style.display="none";
  started=true;
  if(mode==="team"){
    elev.y=0; elev.floor=0; elev.target=0; elev.state="closed"; elev.doorT=0;
    teamPlayers=slots.length;
    if(net.isHost||!net.on){
      const list=spawnZombieList(slots.length,["b",0,1,2,3,4]);  // 屋上は地下のスイッチまで湧かない
      placeZombies(list);
      if(net.isHost&&net.on) bcast({t:"zsp",a:list});
    }
  }
  guide(mode==="team" ? "地下のスイッチを押して、屋上にエレベーターで戻れ"
        : ((mode==="normal"?"":"［"+mode.toUpperCase()+"］")+
           "どこかに敵が"+Math.max(0,slots.length-1)+"人いる。銃の弾は尽きない"),6);
  spawnLabel.innerHTML=mySpawn.fl+" スタート"+
    '<div style="font-size:12px;letter-spacing:.16em;color:#8b8578;margin-top:10px">画面をクリックすると操作できます</div>';
  spawnLabel.style.display="block";
  setTimeout(()=>{ spawnLabel.style.display="none"; },2600);
  initAudio(); initGunAudio();
  viewGun.visible=true; if(viewSG) viewSG.visible=false;
  refreshHud(); refreshInv();
  renderer.domElement.requestPointerLock();
}
/* 残り1発で壊れる盾は点滅させる */
function blinkOn(){ return (Math.floor(elapsed*5.5)%2)===0; }

/* 撃たれてから復帰するまで：吹っ飛び → 倒れる → 点滅 → リスポーン */
const down={active:false,t:0,kx:0,kz:0,roll:0};
function startDown(kx,kz,dur){
  down.active=true; down.t=0; down.kx=kx; down.kz=kz; crouch=false;
  down.dur=dur||DOWN_T;
  const rx=Math.cos(player.yaw), rz=-Math.sin(player.yaw);
  down.roll=((kx*rx+kz*rz)>=0?1:-1)*1.18;
  promptEl.style.opacity=0;
  shake=1.4;
  P[net.mySlot].mov=0;
}
function updateDown(dt){
  down.t+=dt;
  const k=Math.min(1,down.t/0.45);
  if(down.t<0.45){                      // 分割して壁を抜けないように
    const st=1.7*dt/0.45/6;
    for(let i=0;i<6;i++) moveEntity(player.pos,down.kx*st,down.kz*st,PLAYER_R,player.pos.y);
  }
  player.pos.y=surfaceAt(player.pos.x,player.pos.z,player.pos.y);
  player.vy=0;
  const me=P[net.mySlot];
  me.x=player.pos.x; me.y=player.pos.y; me.z=player.pos.z; me.mov=0;
  let sx=0,sy=0;
  if(shake>0){ shake=Math.max(0,shake-dt*2.0);
    sx=(Math.random()-0.5)*shake*0.2; sy=(Math.random()-0.5)*shake*0.2; }
  const eye=EYE+(0.40-EYE)*k;
  camera.position.set(player.pos.x+sx,player.pos.y+eye+sy,player.pos.z);
  camera.rotation.set(player.pitch*(1-k)+0.22*k,player.yaw,down.roll*k,"YXZ");
  if(viewGun) viewGun.visible=false;
  if(viewSG)  viewSG.visible=false;
  if(viewShield) viewShield.visible=false;
  /* 倒れきったら点滅 */
  dmgEl.style.opacity = (down.t<0.6) ? "0.9"
    : ((Math.floor(down.t*7)%2===0)?"0.72":"0.12");
  if(mode==="team"){
    /* Teamは20秒その場で倒れる。仲間の回復薬で復帰できる */
    if(!P[net.mySlot].dn){ down.active=false; dmgEl.style.opacity="0"; standUp(); return; }
    return;
  }
  if(down.t>=down.dur){
    down.active=false;
    dmgEl.style.opacity="0";
    P[net.mySlot].down=0;
    if(alive) respawn(); else eliminate();
  }
}
function standUp(){          // Teamで助け起こされたとき
  P[net.mySlot].down=0;
  invuln=1.6; crouch=false; crouchT=0;
  if(viewGun) viewGun.visible=(weapon===0);
  if(viewSG)  viewSG.visible=(weapon===1);
  if(viewShield) viewShield.visible=(shield>0);
  guide("助け起こされた",3);
}
function respawn(){
  player.pos.set(mySpawn.x,mySpawn.y,mySpawn.z);
  player.yaw=mySpawn.yaw; player.pitch=0; player.vy=0;
  invuln=1.6; shake=0; crouch=false;
  if(viewGun) viewGun.visible=(weapon===0);
  if(viewSG)  viewSG.visible=(weapon===1);
  if(viewShield) viewShield.visible=(shield>0);
  spawnLabel.innerHTML=mySpawn.fl+" にリスポーン";
  spawnLabel.style.display="block";
  clearTimeout(respawn._t);
  respawn._t=setTimeout(()=>{ spawnLabel.style.display="none"; },1800);
}
function eliminate(){
  alive=false;
  document.exitPointerLock&&document.exitPointerLock();
  deadEl.style.display="block";
}
function hitFlash(){
  FX.hurt();
  dmgEl.style.opacity="1"; shake=Math.max(shake,1.0);
}

/* ============================================================
   プレイヤー
   ============================================================ */
function updatePlayer(dt){
  const fwd=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
  const rgt=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  let mx=0,mz=0;
  if(alive){
    if(keysHeld["KeyW"]||keysHeld["ArrowUp"]){mx+=fwd.x;mz+=fwd.z;}
    if(keysHeld["KeyS"]||keysHeld["ArrowDown"]){mx-=fwd.x;mz-=fwd.z;}
    if(keysHeld["KeyD"]||keysHeld["ArrowRight"]){mx+=rgt.x;mz+=rgt.z;}
    if(keysHeld["KeyA"]||keysHeld["ArrowLeft"]){mx-=rgt.x;mz-=rgt.z;}
  }
  const len=Math.hypot(mx,mz);
  const wantRun=(keysHeld["ShiftLeft"]||keysHeld["ShiftRight"])&&player.stam>1&&len>0&&!crouch;
  const sp=crouch?WALK*CROUCH_SPD:(wantRun?RUN:WALK);
  crouchT+=((crouch?1:0)-crouchT)*Math.min(1,dt*9);
  if(wantRun) player.stam=Math.max(0,player.stam-dt*24);
  else player.stam=Math.min(100,player.stam+dt*15);
  stamFill.style.width=player.stam+"%";
  stamFill.style.background=player.stam<25?"#a3271f":"#8b8578";
  /* 満タンのときは出さない。走って減っている間と、回復し切るまでだけ見せる */
  if(stamEl) stamEl.style.opacity=(player.stam<99.5)?"1":"0";

  if(len>0){
    mx/=len;mz/=len;
    moveEntity(player.pos,mx*sp*dt,mz*sp*dt,PLAYER_R,player.pos.y);
    player.bob+=dt*(crouch?5.5:(wantRun?13:8.5));
    if(!player.riding) footstep(dt,wantRun,crouch);
  }
  const inCar = player.pos.x>14.3 && player.pos.x<19.9 && Math.abs(player.pos.z)<2.9;
  player.riding=inCar;
  if(inCar){ player.pos.y=elev.y; player.vy=0; }
  else{
    const g=surfaceAt(player.pos.x,player.pos.z,player.pos.y);
    if(player.pos.y>g+0.04){
      player.vy-=15*dt; player.pos.y+=player.vy*dt;
      if(player.pos.y<g){player.pos.y=g;player.vy=0;}
    }else{ player.pos.y=g; player.vy=0; }
    rescueIfFallen();
  }
  if(player.pos.y<-2 && !flashOn) flashOn=true;   // 地下は自動で点灯
  if(invuln>0) invuln-=dt;
  if(muzzleT>0){ muzzleT-=dt; muzzle.intensity=muzzleT>0?3.4:0; }
  if(recoil>0){
    recoil=Math.max(0,recoil-dt*5.0);
    viewGun.position.set(0.20,-0.19+recoil*0.02,-0.31+recoil*0.085);
    viewGun.rotation.x=0.06+recoil*0.22;
    if(viewSG){
      viewSG.position.set(0.20,-0.20+recoil*0.03,-0.26+recoil*0.13);
      viewSG.rotation.x=0.04+recoil*0.26;
    }
  }
  let sx=0,sy=0;
  if(shake>0){
    shake=Math.max(0,shake-dt*2.0);
    sx=(Math.random()-0.5)*shake*0.16; sy=(Math.random()-0.5)*shake*0.16;
  }
  const bobY=Math.sin(player.bob)*0.035*(len>0?1:0);
  const eyeH=EYE-(EYE-CROUCH_EYE)*crouchT;
  camera.position.set(player.pos.x+sx,player.pos.y+eyeH+bobY+sy,player.pos.z);
  camera.rotation.set(player.pitch,player.yaw,0,"YXZ");

  const fi=player.pos.y<-2?-1:Math.max(0,Math.min(FLOORS,Math.round(player.pos.y/FH)));
  floorLabel.textContent=(fi<0)?"B1":FLOOR_NAME[fi];

  const me=P[net.mySlot];
  me.x=player.pos.x; me.y=player.pos.y; me.z=player.pos.z; me.yaw=player.yaw;
  me.mov=len>0?(crouch?3:(wantRun?2:1)):0;
  me.cr=crouch?1:0;
  viewGun.visible=alive&&weapon===0;
  if(viewSG) viewSG.visible=alive&&weapon===1;
  if(viewShield) viewShield.visible=alive&&shield>0&&(shield>1||blinkOn());
}

/* ---------- 他プレイヤーの補間表示 ---------- */
const _qTilt=new THREE.Quaternion(), _qYaw=new THREE.Quaternion();
const _axis=new THREE.Vector3(), _eul=new THREE.Euler();
function setAvatarWeapon(av,w){
  av.w=w;
  while(av.hold.children.length) av.hold.remove(av.hold.children[0]);
  const m=w?makeShotgunMesh(0.95):makeGunMesh(1.15);
  m.rotation.set(0,w?0:Math.PI,0);
  if(w) m.position.set(0,0,-0.10);
  av.hold.add(m);
}
function updateRemotes(dt){
  for(let i=0;i<MAXP;i++){
    const p=P[i];
    if(i===net.mySlot){ continue; }
    if(!p.used){ if(p.av){ scene.remove(p.av.g); p.av=null; } continue; }
    if(!p.av) p.av=makeAvatar(i);
    if(p.av.w!==(p.w||0)) setAvatarWeapon(p.av,p.w||0);
    const wantSh=((p.sh||0)>0);
    if(wantSh!==!!p.av.shield){
      if(wantSh){
        const sm=makeShieldMesh(0.55);
        sm.position.set(-0.30,1.02,-0.30); sm.rotation.y=Math.PI;
        p.av.g.add(sm); p.av.shield=sm;
      }else{ p.av.g.remove(p.av.shield); p.av.shield=null; }
    }
    if(p.av.shield) p.av.shield.visible=((p.sh||0)>1)||blinkOn();
    const team=(mode==="team");
    if(team) p.down=(p.dn||0);          // Teamは倒れている残り時間がそのまま姿勢の基準
    if(p.down>0){
      if(!team) p.down-=dt;
      { const kk=Math.min(1,dt*6);      // 倒れていても位置は追いかける
        p.x+=(p.tx-p.x)*kk; p.y+=(p.ty-p.y)*kk; p.z+=(p.tz-p.z)*kk; }
      const el=team?Math.min(1,TEAM_DOWN_T-p.dn):(DOWN_T-p.down);
      const f=Math.min(1,el/0.45);
      p.av.g.position.set(p.x,p.y,p.z);   // ずれは本人の座標に含まれている
      _qTilt.setFromAxisAngle(_axis.set(p.dkz,0,-p.dkx).normalize(),f*Math.PI*0.5);
      _qYaw.setFromEuler(_eul.set(0,p.yaw,0));
      p.av.g.quaternion.copy(_qTilt).multiply(_qYaw);
      p.av.g.visible = team ? true : ((el<0.6) ? true : (Math.floor(el*7)%2===0));
      for(const l of p.av.legs) l.rotation.x=0;
      if(p.down<=0){
        p.down=0;
        if(p.npc&&p.alive&&p.pendSp!=null&&SPAWNS[p.pendSp]) npcRespawn(i,SPAWNS[p.pendSp]);
        p.x=p.tx; p.y=p.ty; p.z=p.tz; p.yaw=p.tyaw;
        p.av.g.quaternion.copy(_qYaw.setFromEuler(_eul.set(0,p.yaw,0)));
        p.av.g.visible=p.alive;
      }
      continue;
    }
    const k=Math.min(1,dt*12);
    p.x+=(p.tx-p.x)*k; p.y+=(p.ty-p.y)*k; p.z+=(p.tz-p.z)*k;
    let dy=p.tyaw-p.yaw;
    while(dy>Math.PI) dy-=Math.PI*2;
    while(dy<-Math.PI) dy+=Math.PI*2;
    p.yaw+=dy*k;
    p.av.g.position.set(p.x,p.y,p.z);
    p.av.g.quaternion.copy(_qYaw.setFromEuler(_eul.set(0,p.yaw,0)));
    p.av.g.visible=p.alive;
    p.av.crv+=((p.cr?1:0)-p.av.crv)*Math.min(1,dt*9);
    p.av.core.scale.y=1-0.38*p.av.crv;
    p.av.t+=dt*(p.mov?(p.mov===2?13:(p.mov===3?6:9)):0);
    const a=Math.sin(p.av.t)*(p.mov?(p.mov===3?0.30:0.55):0);
    p.av.legs[0].rotation.x=a;  p.av.legs[1].rotation.x=-a;
    p.av.arms[0].rotation.x=-a*0.5; p.av.arms[1].rotation.x=a*0.5;
    /* 足音 */
    if(p.alive&&p.mov){
      const run=(p.mov===2), cr=(p.mov===3);
      p.stepT=(p.stepT||0)-dt*(run?3.15:(cr?1.20:2.03));
      if(p.stepT<=0){ p.stepT=1; stepAt(p.x,p.y,p.z,run,cr); }
    }else p.stepT=0.35;
  }
}

/* ============================================================
   射撃
   ============================================================ */
const _org=new THREE.Vector3(), _dir=new THREE.Vector3(), _tp=new THREE.Vector3();
const _jd=new THREE.Vector3(), _mz=new THREE.Vector3();
let _shotRay=null;

/* 当たり判定。
   拳銃  : ブレなし。照準が胴（半径 HIT_R）に乗っていれば距離に関係なく命中
   ショットガン: 5m未満=判定1.5倍／5〜10m=0.5倍／10m以上=命中しない
   SPREAD はNPCの命中率の基準にだけ残してある */
const HIT_R=0.42, SPREAD=Math.atan(HIT_R/5.0);
/* 連射すると銃口が跳ね上がったまま戻らなくなる。1秒撃たなければ元に戻る */
function bloomAngle(){ return BLOOM_STEP*Math.min(bloomN,BLOOM_MAX); }
function bloomRatio(){ return Math.min(bloomN,BLOOM_MAX)/BLOOM_MAX; }
function updateBloom(dt){
  if(pistolLock>0){
    pistolLock-=dt;
    if(pistolLock<=0){ pistolLock=0; bloomN=0; bloomT=0; }   // 撃てるようになるとブレも戻る
    return;
  }
  if(bloomT>0){ bloomT-=dt; if(bloomT<=0){ bloomT=0; bloomN=0; } }
}
const PISTOL_RANGE=400;
function hitScale(sg,d){
  if(!sg) return 1.0;
  return (d<SG_RANGE)?1.5:0;     // 10m未満は判定1.5倍、10m以上は当たらない
}
/* 曳光（どこへ逸れたかが見えるように） */
let tracer=null, tracerT=0;
const TRACER_N=6;
function showTracer(ox,oy,oz,d,len,dirs){
  if(!tracer){
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(TRACER_N*6),3));
    tracer=new THREE.LineSegments(g,new THREE.LineBasicMaterial({
      color:0xffe0a8,transparent:true,opacity:0.5,fog:false}));
    tracer.frustumCulled=false; scene.add(tracer);
  }
  const a=tracer.geometry.attributes.position;
  for(let i=0;i<TRACER_N;i++){
    const v=dirs?(dirs[i]||dirs[0]):(i===0?d:null);
    if(!v){ a.setXYZ(i*2,ox,oy,oz); a.setXYZ(i*2+1,ox,oy,oz); continue; }
    a.setXYZ(i*2,ox,oy,oz);
    a.setXYZ(i*2+1,ox+v.x*len,oy+v.y*len,oz+v.z*len);
  }
  a.needsUpdate=true; tracer.visible=true; tracerT=0.055;
}
function updateTracer(dt){
  if(tracerT>0){ tracerT-=dt; if(tracerT<=0&&tracer) tracer.visible=false; }
}
/* ショットガンを構えて5m以内を狙っているときだけ、照準を頭ほどの大きさに広げる */
const HEAD_SIZE=0.30;
const _aimRay=new THREE.Raycaster();
let crossT=0, crossD=99, crossWide=false, crossCool=false;
/* いま撃てば当たる相手までの距離。壁や床には反応しない */
function aimDistance(){
  const cpi=Math.cos(player.pitch);
  _dir.set(-Math.sin(player.yaw)*cpi,Math.sin(player.pitch),-Math.cos(player.yaw)*cpi);
  _org.copy(camera.position);
  let d=99;
  const f=hitScale(true,1.0), fv=Math.max(1.0,f);
  for(let i=0;i<MAXP;i++){
    if(i===net.mySlot) continue;
    const p=P[i];
    if(!p.used||!p.alive||p.down>0) continue;
    const cr=!!p.cr;
    const cx=p.x, cy=p.y+(cr?CROUCH_CY:1.10), cz=p.z;
    const t=(cx-_org.x)*_dir.x+(cy-_org.y)*_dir.y+(cz-_org.z)*_dir.z;
    if(t<0.4||t>=d||t>=SG_RANGE) continue;
    const dh=Math.hypot(_org.x+_dir.x*t-cx,_org.z+_dir.z*t-cz);
    const dv=_org.y+_dir.y*t-cy;
    const lo=(cr?CROUCH_LO:-1.05), hi=(cr?CROUCH_HI:0.72);
    if(dh>HIT_R*f||dv<lo*fv||dv>hi*fv) continue;
    _tp.set(cx,cy,cz);
    if(!losClear(_org,_tp)) continue;
    d=t;
  }
  return d;
}
function setCross(px){
  crossEl.style.width=px+"px";
  crossEl.style.height=px+"px";
  crossEl.style.margin=(-px/2)+"px 0 0 "+(-px/2)+"px";
}
function updateCrosshair(dt){
  crossT-=dt;
  if(crossT<=0){
    crossT=0.08;
    crossD=(weapon===1&&alive&&!down.active)?aimDistance():99;
  }
  const sg=(weapon===1&&alive&&!down.active);
  /* ショットガンで10m以上を狙っているときは、そもそも当たらないので照準を出さない */
  crossEl.style.display=(sg&&crossD>=SG_RANGE)?"none":"";
  const wide=sg&&crossD<SG_RANGE;
  if(!sg){                       // 拳銃は連射で乱れても照準は通常のまま
    setCross(6);
    if(crossWide){ crossEl.classList.remove("wide"); crossWide=false; }
    const lk=(pistolLock>0);
    if(lk!==crossCool){ crossEl.classList.toggle("cool",lk); crossCool=lk; }
    return;
  }
  if(wide){
    const half=Math.tan(camera.fov*Math.PI/360);
    const px=Math.max(20,Math.min(150,(HEAD_SIZE/Math.max(0.6,crossD))/(2*half)*innerHeight));
    setCross(Math.round(px));
    if(!crossWide){ crossEl.classList.add("wide"); crossWide=true; }
  }else if(crossWide){
    setCross(6); crossEl.classList.remove("wide"); crossWide=false;
  }
  /* 装填中は照準を薄く */
  const cool=(weapon===1&&sgCool>0)||(weapon===0&&pistolLock>0);
  if(cool!==crossCool){ crossEl.classList.toggle("cool",cool); crossCool=cool; }
}
function shoot(){
  if(!started||finished||!alive||down.active) return;
  const sg=(weapon===1);
  if(sg&&sgCool>0) return;                    // 次弾装填中
  if(!sg&&pistolLock>0) return;               // 連射しすぎて撃てない
  if(sg) sgCool=SG_COOL;
  playGunShot(sg?2.0:1.0, sg?1/1.2:1.0);   // ショットガンは1.2倍の長さで低く鳴る
  FX.fired(sg);
  muzzleT=sg?0.09:0.07; recoil=1.0; shake=Math.max(shake,sg?0.55:0.3);
  act({t:"fire",w:weapon});
  const cp=camera.position;
  _org.set(cp.x,cp.y,cp.z);
  const cpi=Math.cos(player.pitch);
  _dir.set(-Math.sin(player.yaw)*cpi,Math.sin(player.pitch),-Math.cos(player.yaw)*cpi);

  /* 照準が体に乗っているかを見る。判定の大きさは武器と距離で変わる */
  const maxR=sg?SG_RANGE:PISTOL_RANGE;
  let best=-1,bestT=1e9,bestHead=false;
  for(let i=0;i<MAXP;i++){
    if(i===net.mySlot||mode==="team") continue;   // Teamは味方に当たらない
    const p=P[i];
    if(!p.used||!p.alive||p.down>0) continue;
    const cr=!!p.cr;
    const cx=p.x, cy=p.y+(cr?CROUCH_CY:1.10), cz=p.z;
    const vx=cx-_org.x, vy=cy-_org.y, vz=cz-_org.z;
    const t=vx*_dir.x+vy*_dir.y+vz*_dir.z;
    if(t<0.4||t>maxR||t>=bestT) continue;
    const f=hitScale(sg,t);
    if(f<=0) continue;
    const dh=Math.hypot(_org.x+_dir.x*t-cx,_org.z+_dir.z*t-cz);
    const dv=_org.y+_dir.y*t-cy;
    const fv=Math.max(1.0,f);          // 縦は狭めない（目線の高さが胴の中心より上にあるため）
    const lo=(cr?CROUCH_LO:-1.05), hi=(cr?CROUCH_HI:0.72);
    if(dh>HIT_R*f||dv<lo*fv||dv>hi*fv) continue;
    _tp.set(cx,cy,cz);
    if(!losClear(_org,_tp)) continue;   // 机や棚が間にあれば当たらない
    best=i; bestT=t;
    bestHead=(dv>=(cr?0.20:HEAD_LOW)&&dh<=HEAD_R);   // 頭に当たったか
  }

  /* 連射で乱れたぶんだけ、弾は照準からずれて飛ぶ */
  let jr=0;
  if(!sg){
    const R=bloomAngle();
    if(R>0){
      jr=R*Math.sqrt(Math.random());
      const a=Math.random()*Math.PI*2;
      const sy2=player.yaw+Math.cos(a)*jr, sp2=player.pitch+Math.sin(a)*jr, c3=Math.cos(sp2);
      _jd.set(-Math.sin(sy2)*c3,Math.sin(sp2),-Math.cos(sy2)*c3);
    }else _jd.copy(_dir);
    bloomN++; bloomT=BLOOM_COOL;
    if(bloomN>=PISTOL_BURST) pistolLock=PISTOL_LOCK;
  }else _jd.copy(_dir);
  _mz.set(0.20,-0.14,-0.60); camera.localToWorld(_mz);
  let len=45;
  if(!_shotRay) _shotRay=new THREE.Raycaster();
  _shotRay.set(_mz,_jd); _shotRay.near=0.2; _shotRay.far=45;
  const hits=_shotRay.intersectObjects(losBlockers,false);
  if(hits.length) len=hits[0].distance;
  if(best>=0) len=Math.min(len,bestT+0.5);
  if(sg){
    len=Math.min(len,SG_RANGE+2.0);
    const dirs=[];
    for(let i=0;i<6;i++){
      const a=Math.random()*Math.PI*2, r=0.055*Math.sqrt(Math.random());
      const yy=player.yaw+Math.cos(a)*r, pp=player.pitch+Math.sin(a)*r, cc=Math.cos(pp);
      dirs.push(new THREE.Vector3(-Math.sin(yy)*cc,Math.sin(pp),-Math.cos(yy)*cc));
    }
    showTracer(_mz.x,_mz.y,_mz.z,_jd,len,dirs);
    FX.shot(_mz,dirs,len,true);
  }else{
    showTracer(_mz.x,_mz.y,_mz.z,_jd,len,null);
    FX.shot(_mz,[_jd],len,false);
  }

  player.pitch=Math.min(1.45,player.pitch+(sg?0.10:0.018));
  if(sg) player.yaw+=(Math.random()-0.5)*0.024;

  /* Teamモードはゾンビが的 */
  let zTarget=null, zT=1e9;
  if(mode==="team"){
    const all=boss?zombies.concat([boss]):zombies;
    for(const z of all){
      if(z.dead) continue;
      const R=z.boss?1.55:0.46, cy=z.y+(z.boss?2.7:1.05), hh=z.boss?2.7:0.95;
      const vx=z.pos.x-_org.x, vy=cy-_org.y, vz=z.pos.z-_org.z;
      const t=vx*_dir.x+vy*_dir.y+vz*_dir.z;
      if(t<0.4||t>maxR||t>=zT) continue;
      const dh=Math.hypot(_org.x+_dir.x*t-z.pos.x,_org.z+_dir.z*t-z.pos.z);
      const dv=_org.y+_dir.y*t-cy;
      const f=sg?hitScale(true,t):1.0;
      if(f<=0) continue;
      if(dh>R*f||Math.abs(dv)>hh*Math.max(1,f)) continue;
      _tp.set(z.pos.x,cy,z.pos.z);
      if(!losClear(_org,_tp)) continue;
      zTarget=z; zT=t;
    }
    if(zTarget&&jr>0&&zT*Math.tan(jr)>HIT_R) zTarget=null;
    if(zTarget){
      act({t:"zhit",id:zTarget.id,dmg:sg?3:1});
      FX.hitConfirm(false,null,zTarget);
      crossEl.classList.add("hit");
      setTimeout(()=>crossEl.classList.remove("hit"),160);
    }
  }
  if(best>=0&&jr>0&&bestT*Math.tan(jr)>HIT_R) best=-1;   // 乱れて的を外れた
  if(best>=0){
    act({t:"hit",target:best,head:bestHead,w:weapon});
    FX.hitConfirm(bestHead,P[best],null);
    crossEl.classList.add(bestHead?"head":"hit");
    setTimeout(()=>{ crossEl.classList.remove("hit"); crossEl.classList.remove("head"); },160);
  }
}

/* ============================================================
   インタラクト
   ============================================================ */
let current=null;
function updateInteract(){
  current=null;
  if(!alive){ promptEl.style.opacity=0; return; }
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
    if(d<bestD){bestD=d;current={it:it,txt:txt};}
  }
  if(current){ promptEl.innerHTML='<span>E</span>'+current.txt; promptEl.style.opacity=1; }
  else promptEl.style.opacity=0;
}

/* ============================================================
   HUD / ロビー
   ============================================================ */
function refreshHud(){
  let h="";
  if(mode==="team"){
    const me=P[net.mySlot];
    h=(me&&me.dn)?('<b class="dn">倒れている '+Math.ceil(me.dn)+'秒</b>')
      :(hasPot?'<b class="pot">回復薬を所持</b>':'');
  }else{
    for(let i=0;i<LIVES;i++) h+='<i class="'+(i<lives?"":"gone")+'"></i>';
  }
  hpBar.innerHTML=h;
  if(shBar){
    if(shield>0){
      let s="";
      for(let i=0;i<SHIELD_MAX;i++) s+='<i class="'+(i<shield?"":"gone")+'"></i>';
      shBar.innerHTML='<b>盾</b>'+s; shBar.style.display="flex";
      shBar.className="sh"+(shield<=1?" warn":"");
    }else shBar.style.display="none";
  }
  statusEl.className=(lives<=1&&alive)?"low":"";
  let n=0, rows="";
  for(let i=0;i<MAXP;i++){
    const p=P[i]; if(!p.used) continue;
    if(p.alive) n++;
    let dots="";
    if(mode==="team") dots=p.alive?"":"脱落";
    else for(let k=0;k<LIVES;k++) dots+=(k<p.lives?"●":"○");
    const tag=(i===net.mySlot)?"（あなた）":(p.npc?"（NPC）":"");
    let kl='';
    if(mode==="team"){
      kl=' <em class="kills">討伐'+(p.kills||0)+'</em>';
      if(p.dn) kl+=' <em class="dn">倒れている</em>';
      else if(p.pot) kl+=' <em class="pot">薬</em>';
    }
    rows+='<div class="pr'+(p.alive?"":" out")+'"><span style="color:'+SLOT_CSS[i]+'">■</span> '+
          SLOT_NAME[i]+tag+' <b>'+dots+'</b>'+kl+'</div>';
  }
  rosterEl.innerHTML=rows;
  aliveEl.textContent="残り "+n+"人";
}
const MODE_DESC={
  team:  "屋上から降りてゾンビを狩り、地下のスイッチを入れて屋上へ戻る。味方には当たらない。ボスを倒せばクリア、討伐数で順位が決まる。1〜6人",
  easy:  "アイテムも部屋もなし。フロアの閉鎖もなし。純粋な撃ち合い。2〜4人",
  normal:"3分で1Fが閉鎖され、以後1分ごとに上の階も閉じる。7分で屋上だけが残る。2〜4人",
  hard:  "ライフが1。一発で脱落する。フロアの閉鎖はなし。2〜4人"
};
function renderMode(){
  if(!modeDesc) return;
  for(const b of document.querySelectorAll(".modebtn"))
    b.className="sub2 modebtn"+(b.getAttribute("data-m")===mode?" on":"");
  modeDesc.textContent=MODE_DESC[mode]||"";
}
function lobbyMsg(t){ lobbyInfo.textContent=t; }
function lobbyShow(room,isHost){
  lobbyStep1.style.display="none";
  lobbyStep2.style.display="block";
  roomCodeEl.textContent=room;
  startBtn.style.display=isHost?"inline-block":"none";
  modeSect.className="sect"+(isHost?"":" guest");
  renderMode();
  lobbyMsg(isHost?"このコードを相手に伝えてください。2〜4人で開始できます。"
                 :"ホストが開始するのを待っています。");
}
function renderLobby(list){
  let s="";
  for(let i=0;i<MAXP;i++){
    const inn=list.indexOf(i)>=0;
    const me=(inn&&i===net.mySlot)?"（あなた）":"";
    const tail=inn?me:"　—";
    s+='<div class="lp'+(inn?"":" empty")+'"><span style="color:'+SLOT_CSS[i]+'">■</span> '+SLOT_NAME[i]+tail+'</div>';
  }
  lobbyPlayers.innerHTML=s;
}


/* ============================================================
   DOM参照
   ============================================================ */
const promptEl=document.getElementById("prompt");
const invList=document.getElementById("invlist");
const floorLabel=document.getElementById("floorlabel");
const stamFill=document.getElementById("stamfill");
const stamEl=document.getElementById("stam");
const elevPanel=document.getElementById("elev");
const elevHint=document.querySelector("#elev .hint");
const hpBar=document.getElementById("hpbar");
const shBar=document.getElementById("shbar");
const crouchLab=document.getElementById("crouchlab");
const bossBar=document.getElementById("bossbar");
const bossFill=document.getElementById("bossfill");
const statusEl=document.getElementById("status");
const rosterEl=document.getElementById("roster");
const aliveEl=document.getElementById("alivecount");
const crossEl=document.getElementById("cross");
const dmgEl=document.getElementById("dmg");
const deadEl=document.getElementById("dead");
const spawnLabel=document.getElementById("spawnlabel");
const msgEl=document.getElementById("msg");
const lockvEl=document.getElementById("lockv");
const alarmEl=document.getElementById("alarm");
const bgmBossEl=document.getElementById("bgmboss");
const bgmEl=document.getElementById("bgmmenu");
const bgmBtn=document.getElementById("bgmbtn");
const winEl=document.getElementById("win");
const winTitle=document.getElementById("wintitle");
const winText=document.getElementById("wintext");
const lobbyEl=document.getElementById("lobby");
const lobbyStep1=document.getElementById("step1");
const lobbyStep2=document.getElementById("step2");
const lobbyInfo=document.getElementById("lobbyinfo");
const lobbyPlayers=document.getElementById("lobbyplayers");
const roomCodeEl=document.getElementById("roomcode");
const startBtn=document.getElementById("startbtn");
const modeSect=document.getElementById("modesect");
const modeDesc=document.getElementById("modedesc");

/* ============================================================
   初期化
   ============================================================ */
function init(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x04060a);
  scene.fog=new THREE.FogExp2(0x04060a,0.040);

  camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,0.05,120);
  camera.rotation.order="YXZ";
  scene.add(camera);

  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(FX.pixelRatio());
  renderer.setSize(innerWidth,innerHeight);
  renderer.outputEncoding=THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);
  FX.initRenderer();

  initTex(); FX.textures(TEX,makeTex); initMat(); FX.materials(MAT,TEX);

  AMB=new THREE.AmbientLight(0x232b3a,0.82); scene.add(AMB);
  HEM=new THREE.HemisphereLight(0x2c364c,0x07090d,0.55); scene.add(HEM);

  const fl=new THREE.SpotLight(0xfff0cd,2.35,29,Math.PI/6.4,0.56,1.15);
  fl.position.set(0.18,-0.12,0);
  const tgt=new THREE.Object3D(); tgt.position.set(0,0,-12); camera.add(tgt);
  fl.target=tgt; camera.add(fl);
  window.flashlight=fl; flashTarget=tgt;
  const near=new THREE.PointLight(0xffe8c4,0.32,3.4); camera.add(near); nearLight=near;

  /* 全員が最初から銃を持っている */
  viewGun=makeGunMesh(1.0);
  viewGun.position.set(0.20,-0.19,-0.31);
  viewGun.rotation.set(0.04,0.08,0);
  viewGun.visible=false; camera.add(viewGun);
  viewSG=makeShotgunMesh(0.80);
  viewSG.position.set(0.20,-0.20,-0.26);
  viewSG.rotation.set(0.04,0.05,0);
  viewSG.visible=false; camera.add(viewSG);
  muzzle=new THREE.PointLight(0xffd9a0,0,7); muzzle.position.set(0.20,-0.14,-0.72);
  camera.add(muzzle);

  viewShield=makeShieldMesh(0.55);
  viewShield.position.set(-0.42,-0.60,-0.78);
  viewShield.rotation.set(0.05,Math.PI+0.26,-0.07);
  viewShield.visible=false; camera.add(viewShield);

  for(let i=0;i<FLOORS;i++) buildFloor(i);
  buildRoof();
  buildStairs();
  buildElevator();
  buildSky();

  /* --- 非常階段・屋上の扉はすべて開錠済み --- */
  for(const y of LEVELS.slice(0,FLOORS))
    makeDoor({x:-14,y:y,z:0,axis:"z",width:1.5,hingeSign:1,locked:false,
      name:"非常階段のドア",sign:"EXIT",color:0xc2402f,faceSign:1});
  makeDoor({x:-14,y:ROOF_Y,z:0,axis:"z",width:1.5,hingeSign:1,locked:false,
    name:"屋上のドア",sign:"ROOF",color:0x7fd8e8,faceSign:-1});

  /* --- 地下室のショットガン（取られると屋上にもう1挺出る） --- */
  makeItem("sg1",makeShotgunMesh(1.0),0,BASE_Y,-17.4,"ショットガンを拾う",
    (slot)=>{
      P[slot].w=1;
      if(slot===net.mySlot){ setWeapon(1); guide("ショットガンは、近距離で威力を発揮する",5); }
      else guide("誰かがショットガンを手に入れた。屋上にもショットガンがある",5);
      spawnRoofShotgun();
    },0.55);

  buildEvPower(0);        // 1F ロビー
  buildEvPower(16);       // 5F 廊下

  /* --- 照明スイッチ 2F機械室2B / 3F会議室3B / 4F休憩室4D / 5F備品庫5D --- */
  lightSwitches=[
    makeLightSwitch( 4, 8.75,"LIGHTING"),
    makeLightSwitch( 8, 8.75,"LIGHTING"),
    makeLightSwitch(12,-8.75,"LIGHTING"),
    makeLightSwitch(16,-8.75,"LIGHTING")
  ];
  /* Teamモード用。地下の制御盤と、階段を分断する壁（普段は無効） */
  baseSwitch=makeLightSwitch(BASE_Y,-19.9,"ELEV CTRL",0);
  teamWalls=[];
  for(const hy of [6,14]){
    const m=box(1.9,2.4,6.4,-21.85,hy+1.2,0,MAT.concrete);
    teamWalls.push({mesh:m,col:colliders[colliders.length-1]});
  }
  setLights(true);

  loadGunModel();
  loadShotgunModel();
  loadZombieModel();
  loadBossModel();
  refreshInv(); refreshHud();

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
  if(!started||finished)return;
  if(climb.active||down.active) return;
  if(alive){
    if(e.code==="KeyE"&&current){ current.it.use(); }
    if(e.code==="KeyF"&&lightsOffHere()){ flashOn=!flashOn; sfx("click"); }
    if(e.code==="KeyC"){ crouch=!crouch; sfx("click"); }
    if(player.riding&&elev.state!=="moving"){
      for(let f=0;f<EV_STOPS;f++)
        if(e.code==="Digit"+(f+1)||e.code==="Numpad"+(f+1)) elevGoTo(f);
    }
  }
  if(["Space","ArrowUp","ArrowDown","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6"].indexOf(e.code)>=0) e.preventDefault();
});
addEventListener("keyup",e=>{ keysHeld[e.code]=false; });
addEventListener("blur",()=>{ for(const k in keysHeld) keysHeld[k]=false; });
document.addEventListener("pointerlockchange",()=>{
  if(document.pointerLockElement!==renderer.domElement)
    for(const k in keysHeld) keysHeld[k]=false;
});
addEventListener("mousemove",e=>{
  if(document.pointerLockElement!==renderer.domElement)return;
  player.yaw-=e.movementX*sens;
  player.pitch-=e.movementY*sens;
  player.pitch=Math.max(-1.45,Math.min(1.45,player.pitch));
});
addEventListener("click",(e)=>{
  if(e.target&&e.target.closest&&e.target.closest("#pause .card")) return;
  if(started&&!finished&&document.pointerLockElement!==renderer.domElement)
    renderer.domElement.requestPointerLock();
});
addEventListener("mousedown",e=>{
  if(!started||finished||!alive||climb.active||down.active)return;
  if(document.pointerLockElement!==renderer.domElement)return;
  if(e.button===0) shoot();
});
addEventListener("contextmenu",e=>{ if(started) e.preventDefault(); });

document.getElementById("sensrange").addEventListener("input",e=>{ sens=e.target.value/1000*0.018; FX.setSens(+e.target.value); });
bgmBtn.addEventListener("click",()=>{
  bgmOn=!bgmOn;
  bgmBtn.textContent=bgmOn?"BGM ON":"BGM OFF";
  bgmBtn.className=bgmOn?"on":"";
  if(bgmOn) bgmKick();
});
/* 最初の操作でBGMを鳴らし始める */
for(const ev of ["pointerdown","keydown"])
  addEventListener(ev,()=>{ bgmKick(); },{capture:true});
document.getElementById("hostbtn").addEventListener("click",()=>{
  if(typeof Peer==="undefined"){ lobbyMsg("PeerJS を読み込めませんでした。ネット接続を確認してください。"); return; }
  hostRoom();
});
document.getElementById("joinbtn").addEventListener("click",()=>{
  if(typeof Peer==="undefined"){ lobbyMsg("PeerJS を読み込めませんでした。ネット接続を確認してください。"); return; }
  const v=(document.getElementById("roomin").value||"").replace(/[^0-9]/g,"");
  if(v.length!==4){ lobbyMsg("4桁のルームコードを入力してください。"); return; }
  joinRoom(v);
});
document.getElementById("roomin").addEventListener("keydown",e=>{
  if(e.code==="Enter") document.getElementById("joinbtn").click();
});
startBtn.addEventListener("click",()=>{ hostStart(); });
for(const b of document.querySelectorAll(".modebtn"))
  b.addEventListener("click",()=>{
    if(!net.isHost) return;
    mode=b.getAttribute("data-m");
    renderMode();
    bcast({t:"mode",m:mode});
  });
for(const n of [1,2,3])
  document.getElementById("npc"+n).addEventListener("click",()=>{ startSolo(n); });

/* ============================================================
   メインループ
   ============================================================ */
let netT=0, elevT=0;
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(0.05,clock.getDelta());
  elapsed+=dt;

  if(started&&!finished){
    if(climb.active) updateClimb(dt);
    else if(down.active) updateDown(dt);
    else{ updatePlayer(dt); updateInteract(); }
    if(!net.on) updateNPCs(dt);
    if(mode==="team"){
      if(net.isHost||!net.on){
        updateZombiesTeam(dt); updateTeamGuides();
        updateTeamDown(dt); updateRevive();
        if(net.on) broadcastZombies(dt);
      }
      drawZombies(dt);
      refreshBoss();
    }
    if(net.isHost||!net.on){ updateCamp(dt); updateItemDrop(dt); updateRespawn(dt);
                             updateEvPower(dt); updatePendingEnd(dt);
                             if(mode==="normal") updateLockdown(dt);
                             if(mode==="team"){ updateTeamLock(dt); updateSealedDamage(dt); } }
    /* 閉鎖予告のあいだ、1Fにいる本人だけ画面が赤く明滅する */
    lockvEl.style.display=(alive&&
      inWarnZone(player.pos.x,player.pos.y,player.pos.z))?"block":"none";
    updateRemotes(dt);

    /* 位置の送受信 */
    netT+=dt;
    if(netT>=1/15){
      netT=0;
      if(net.on){
        if(net.isHost){
          const arr=[];
          for(let i=0;i<MAXP;i++){
            const p=P[i]; if(!p.used) continue;
            const me=(i===net.mySlot);
            arr.push({s:i,x:me?p.x:p.tx,y:me?p.y:p.ty,z:me?p.z:p.tz,
                      yaw:me?p.yaw:p.tyaw,m:p.mov,l:p.lives,a:p.alive,c:p.cr?1:0,
                      n:Math.round((p.dn||0)*10)/10,pt:p.pot?1:0,k:p.kills||0});
          }
          bcast({t:"snap",p:arr});
        }else{
          act({t:"pos",x:player.pos.x,y:player.pos.y,z:player.pos.z,yaw:player.yaw,
               mov:P[net.mySlot].mov,c:P[net.mySlot].cr?1:0});
        }
      }
    }
    if(net.isHost&&net.on){
      elevT+=dt;
      if(elevT>=0.12){
        elevT=0;
        bcast({t:"elevs",y:elev.y,f:elev.floor,tg:elev.target,st:elev.state,dt:elev.doorT,
               p:flags.power?1:0,w:evWanted?1:0});
      }
    }

    /* 非常灯 */
    for(let i=0;i<emergLights.length;i++)
      emergLights[i].intensity=0.34+Math.sin(elapsed*3.1+i)*0.10;

    /* 懐中電灯 */
    const canFlash=lightsOffHere();
    window.flashlight.intensity=(flashOn&&canFlash)?2.35:0;
    nearLight.intensity=canFlash?0.32:0.10;
    dmgEl.style.opacity=Math.max(0,(parseFloat(dmgEl.style.opacity)||0)-dt*0.9);

    /* 明るさ */
    const onRoof=player.pos.y>ROOF_Y-1.0;
    const inBase=player.pos.y<-2;
    let ambT,hemT,fogT;
    if(inBase){ ambT=0.032; hemT=0.018; fogT=0.190; }
    else if(flags.lightsOn){ ambT=0.82*FX.ambK; hemT=0.55*FX.ambK; fogT=onRoof?0.016:0.040; }
    else{ ambT=0.032; hemT=0.018; fogT=onRoof?0.012:0.190; } // 消灯時＝ほぼ完全な闇
    const lk=Math.min(1,dt*2.4);
    AMB.intensity+=(ambT-AMB.intensity)*lk;
    HEM.intensity+=(hemT-HEM.intensity)*lk;
    scene.fog.density+=(fogT-scene.fog.density)*Math.min(1,dt*1.4);
    roofLight.intensity+=((onRoof?0.85:0)-roofLight.intensity)*Math.min(1,dt*1.4);
    skyGroup.position.set(camera.position.x,camera.position.y,camera.position.z);
  }

  updateElev(dt);
  updateDoors(dt);
  updateTracer(dt);
  updateGuide(dt);
  updateBgmMenu(dt);
  updateAlarm(dt);
  updateBossBgm(dt);
  if(crouchLab) crouchLab.style.display=(started&&!finished&&alive&&crouch)?"block":"none";
  if(sgCool>0) sgCool=Math.max(0,sgCool-dt);
  updateBloom(dt);
  if(started&&!finished) updateCrosshair(dt);
  for(const f of tickers) f(dt);

  /* 昇降中以外は、扉が閉じていてもかごの中で階数を選べる
     （1F閉鎖や電源断で扉が閉まった状態で閉じ込められないように） */
  const showPanel=started&&!finished&&alive&&player.riding&&elev.state!=="moving";
  elevPanel.style.display=showPanel?"block":"none";
  if(showPanel){
    const dead=!flags.power;
    for(let i=0;i<EV_STOPS;i++)
      document.getElementById("eb"+(i+1)).className="b"+(elev.floor===i?" cur":"")+
        ((dead||floorClosed(i))?" off":"");
    elevHint.textContent=dead?"電源が落ちている":"キーボードの 1 〜 5 で選択";
  }

  FX.frame(dt);
}

init();

