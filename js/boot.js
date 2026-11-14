/* ============================================================
   起動処理：素材を読み込んでから、ライブラリとゲーム本体を順に実行する
   ============================================================ */
(function(){
  "use strict";
  var FILES={
    pistol :"assets/models/pistol.glb",
    shotgun:"assets/models/shotgun.glb",
    zombie :"assets/models/zombie.glb",
    boss   :"assets/models/boss.glb",
    gunshot:"assets/audio/gunshot.mp3"
  };
  var SCRIPTS=[
    "js/vendor/three.min.js",
    "js/vendor/GLTFLoader.js",
    "js/vendor/SkeletonUtils.js",
    "js/vendor/postprocessing.js",
    "js/vendor/peerjs.min.js",
    "js/fx.js",
    "js/game.js"
  ];
  window.ASSETS={};
  var fill=document.getElementById("loadfill"), text=document.getElementById("loadtext"),
      warn=document.getElementById("loadwarn"), root=document.getElementById("load");
  var keys=Object.keys(FILES), total=keys.length+SCRIPTS.length, done=0;
  function step(){ done++; fill.style.width=Math.round(done/total*100)+"%"; }
  function showWarn(msg){ warn.style.display="block"; warn.innerHTML=msg; }

  if(location.protocol==="file:")
    showWarn("このゲームはファイルを直接開くと素材を読み込めません。<br>"+
             "GitHub Pages などのWebサーバー経由で開いてください。");

  function fetchAsset(k){
    return fetch(FILES[k]).then(function(r){
      if(!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    }).then(function(b){ window.ASSETS[k]=b; step(); })
      .catch(function(){ window.ASSETS[k]=null; step(); });   // 無くても簡易モデルで動く
  }
  function loadScript(i){
    if(i>=SCRIPTS.length){ finish(); return; }
    var s=document.createElement("script");
    s.src=SCRIPTS[i]; s.async=false;
    s.onload=function(){ step(); loadScript(i+1); };
    s.onerror=function(){
      if(SCRIPTS[i].indexOf("peerjs")>=0){ step(); loadScript(i+1); return; }  // 通信なしでもNPC戦は遊べる
      text.textContent="LOAD ERROR";
      showWarn("読み込みに失敗しました："+SCRIPTS[i]);
    };
    document.body.appendChild(s);
  }
  function finish(){
    text.textContent="READY";
    setTimeout(function(){ root.className="done"; },250);
    setTimeout(function(){ if(root.parentNode) root.parentNode.removeChild(root); },900);
  }
  Promise.all(keys.map(fetchAsset)).then(function(){ loadScript(0); });
})();
