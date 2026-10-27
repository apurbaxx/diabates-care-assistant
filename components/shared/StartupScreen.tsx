"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./StartupScreen.module.css";

function animateGlobe(cv: HTMLCanvasElement) {
  // Coarse continent outlines as [lon, lat]; rendered as a dot-matrix map.
  var LAND=[
  [[-168,65],[-156,71],[-128,70],[-95,69],[-82,69],[-86,64],[-94,59],[-80,52],[-78,62],[-65,60],[-56,52],[-66,45],[-70,42],[-76,36],[-81,31],[-80,25],[-83,29],[-90,30],[-97,27],[-97,21],[-92,18],[-87,21],[-88,16],[-83,10],[-77,8],[-85,10],[-92,14],[-97,16],[-105,20],[-110,27],[-114,31],[-117,32],[-124,40],[-124,48],[-135,58],[-148,60],[-158,57],[-165,60]],
  [[-73,78],[-60,82],[-30,83],[-20,75],[-22,70],[-40,65],[-45,60],[-52,64],[-56,70],[-68,76]],
  [[-77,8],[-72,12],[-62,10],[-52,5],[-50,0],[-35,-5],[-39,-14],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-65,-41],[-66,-47],[-69,-52],[-72,-54],[-74,-48],[-73,-38],[-71,-30],[-70,-18],[-76,-14],[-81,-5],[-80,0],[-78,3]],
  [[-9,37],[-9,43],[-1,46],[-4,48.5],[2,51],[8,54],[8,57],[12,55],[14,54],[21,55],[24,59],[30,60],[23,60],[22,64],[17,62],[18,59],[12,56],[5,59],[5,62],[14,67],[22,70],[30,70],[40,67],[44,68],[60,69],[70,73],[80,73],[100,77],[112,74],[130,71],[142,72],[160,70],[180,68],[180,65],[165,62],[157,57],[156,51],[150,59],[140,54],[135,44],[130,42],[128,38],[126,35],[126,38],[122,40],[118,38],[122,31],[120,26],[110,21],[106,19],[108,12],[105,9],[100,13],[100,7],[103,1],[98,8],[98,16],[92,22],[88,22],[80,15],[77,8],[73,18],[67,25],[57,25],[50,30],[48,29],[50,25],[56,26],[59,22],[52,16],[44,12],[43,16],[35,28],[34,31],[36,36],[27,37],[24,40],[22,37],[20,40],[14,45],[18,40],[16,38],[12,42],[8,44],[3,43],[0,39],[-5,36]],
  [[-17,21],[-13,28],[-9,32],[-6,36],[10,37],[11,33],[20,31],[32,31],[34,28],[38,20],[43,12],[51,12],[48,5],[40,-3],[40,-11],[35,-20],[33,-26],[28,-33],[20,-35],[18,-32],[12,-17],[13,-8],[9,-1],[9,4],[4,6],[-8,4],[-13,8],[-17,14]],
  [[114,-22],[122,-18],[130,-12],[136,-12],[137,-16],[142,-11],[146,-19],[153,-26],[150,-37],[141,-38],[135,-35],[130,-32],[115,-34],[113,-26]],
  [[-5,50],[1,51],[-2,57],[-5,58.5],[-6,56],[-3,54],[-5,52]],
  [[130,31],[135,34],[140,36],[142,40],[141,45],[140,41],[136,36],[131,34]],
  [[95,5],[98,4],[106,-3],[104,-6],[100,-2]],
  [[109,2],[117,7],[119,1],[116,-4],[110,-3]],
  [[44,-25],[47,-25],[50,-15],[49,-12],[44,-17]],
  [[172,-34],[178,-38],[175,-41],[172,-41]],
  [[172,-41],[174,-42],[171,-46],[167,-46]]
  ];
  function inside(x: number, y: number, p: number[][]){var c=false;for(var i=0,j=p.length-1;i<p.length;j=i++){
    var xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];
    if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
  const D=Math.PI/180;
  const dots: number[][] = [];
  for(var lat=-58;lat<=84;lat+=3.6){
    var step=3.6/Math.max(Math.cos(lat*D),.2);
    for(var lon=-180;lon<180;lon+=step){
      for(var k=0;k<LAND.length;k++){ if(inside(lon,lat,LAND[k])){dots.push([lon*D,lat*D]);break;} }
    }
  }
  const ctx=cv.getContext('2d');
  if (!ctx) return;
  var S=200, dpr=Math.min(window.devicePixelRatio||1,3);
  cv.width=cv.height=S*dpr; ctx.scale(dpr,dpr);
  var R=86, C=S/2, tilt=18*D, st=Math.sin(tilt), ct=Math.cos(tilt);
  const ink='20,32,46';
  let rot=-30*D, last: number | null=null;
  let animationFrame = 0;
  const draw = () => {
    ctx.clearRect(0,0,S,S);
    ctx.beginPath();ctx.arc(C,C,R,0,7);
    ctx.fillStyle='#ffffff';ctx.fill();
    ctx.lineWidth=1.4;ctx.strokeStyle='rgba('+ink+',.85)';ctx.stroke();
    for(var i=0;i<dots.length;i++){
      var l=dots[i][0]-rot, p=dots[i][1];
      var cl=Math.cos(p), z=st*Math.sin(p)+ct*cl*Math.cos(l);
      if(z<=0.02)continue;
      var x=C+R*cl*Math.sin(l), y=C-R*(ct*Math.sin(p)-st*cl*Math.cos(l));
      ctx.fillStyle='rgba('+ink+','+(0.12+0.6*z).toFixed(2)+')';
      ctx.beginPath();ctx.arc(x,y,1.05+0.55*z,0,7);ctx.fill();
    }
  }
  function frame(t: number){
    if(last!==null)rot+=(t-last)/1000*28*D;
    last=t;draw();animationFrame = requestAnimationFrame(frame);
  }
  draw();
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)animationFrame = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(animationFrame);
}

export function StartupScreen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (pathname === "/knowledge-assistant") setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 1500);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!loading || !canvasRef.current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const stopAnimation = animateGlobe(canvasRef.current);
    return () => {
      stopAnimation?.();
      document.body.style.overflow = previousOverflow;
    };
  }, [loading]);

  return (
    <>
      {loading && (
        <div className={styles.screen}>
          <main className={styles.loader} role="status" aria-live="polite" aria-label="Loading ClinIQ">
            <div className={styles.globe} aria-hidden="true">
              <canvas ref={canvasRef} />
              <svg viewBox="0 0 200 200">
                <path
                  className={styles.pulse}
                  pathLength={100}
                  d="M8 100 H64 L74 100 L82 88 L90 112 L100 48 L112 154 L122 100 L132 100 L140 92 L148 100 H192"
                />
              </svg>
            </div>
            <div className={styles.text}>
              <h1 className={styles.brand}>Clin<span>IQ</span></h1>
              <p className={styles.cap}>Loading records<i>.</i><i>.</i><i>.</i></p>
            </div>
          </main>
        </div>
      )}
      <div hidden={loading}>{children}</div>
    </>
  );
}
