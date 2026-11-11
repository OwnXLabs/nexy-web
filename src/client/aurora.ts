// The aurora behind Nexy, the v23 design's background shader (palette "aurora"), drawn at 60%
// size like the design. It runs at 30 frames a second, stops while the page is hidden or the
// background is something else, and holds still for reduced motion.
const PAL = { bg: [.025, .02, .07], a: [.33, .2, .85], b: [.95, .38, .62], c: [1, .62, .45] };
const FS = "precision highp float;uniform vec2 r;uniform float t;uniform vec3 bg,ca,cb,cc;" +
  "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}" +
  "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}" +
  "void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/r.y;float T=t*.035;" +
  "vec2 q=vec2(fbm(p*1.3+vec2(T,0.)),fbm(p*1.3+vec2(3.1,-T)));" +
  "vec2 w=vec2(fbm(p*1.1+1.8*q+vec2(1.7,9.2)+T*1.3),fbm(p*1.1+1.8*q+vec2(8.3,2.8)-T));" +
  "float f=fbm(p*1.0+2.2*w);" +
  "float y=p.y+.08-(w.x-.5)*.9-(q.y-.5)*.4;" +
  "float band=exp(-pow(y*3.2,2.));float band2=exp(-pow((y+.28)*4.5,2.));" +
  "vec3 col=bg;" +
  "col+=ca*smoothstep(.3,.95,f)*.55;" +
  "col+=cb*band*smoothstep(.35,.85,w.y)*.95;" +
  "col+=cc*band2*smoothstep(.45,.9,f)*.55;" +
  "col+=cc*pow(band,6.)*.35;" +
  "col+=ca*.25*exp(-pow((uv.y-.05)*3.,2.));" +
  "col*=1.-.6*pow(length((uv-.5)*vec2(1.1,1.3)),2.);" +
  "col=col/(1.+col*.35);" +
  "gl_FragColor=vec4(pow(col,vec3(.95)),1.);}";

export function initAurora(): void {
  const cv = document.getElementById("aurora") as HTMLCanvasElement | null;
  if (!cv) return;
  const g = cv.getContext("webgl", { antialias: false, preserveDrawingBuffer: false });
  if (!g) { cv.classList.add("flat"); return; }
  const sh = (tp: number, src: string) => { const s = g.createShader(tp)!; g.shaderSource(s, src); g.compileShader(s); return s; };
  const pr = g.createProgram()!;
  g.attachShader(pr, sh(g.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}"));
  g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS));
  g.linkProgram(pr);
  if (!g.getProgramParameter(pr, g.LINK_STATUS)) { console.warn("[nexy] aurora shader:", g.getProgramInfoLog(pr)); cv.classList.add("flat"); return; }
  g.useProgram(pr);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(pr, "p");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const U = (k: string) => g.getUniformLocation(pr, k);
  const [ur, ut] = [U("r"), U("t")];
  g.uniform3fv(U("bg"), PAL.bg); g.uniform3fv(U("ca"), PAL.a); g.uniform3fv(U("cb"), PAL.b); g.uniform3fv(U("cc"), PAL.c);
  const t0 = performance.now();
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let last = 0, drawn = false;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const shown = cv.clientWidth > 0 && !document.hidden;
    const hold = still.matches || document.body.classList.contains("reduce");
    if (!shown || now - last < 33 || (hold && drawn && cv.width === Math.round(cv.clientWidth * .6))) return;
    last = now;
    const w = Math.round(cv.clientWidth * .6), h = Math.round(cv.clientHeight * .6);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.viewport(0, 0, w, h);
    g.uniform2f(ur, w, h);
    g.uniform1f(ut, (hold ? 0 : (now - t0) / 1000) + 20);
    g.drawArrays(g.TRIANGLES, 0, 3);
    drawn = true;
  };
  requestAnimationFrame(frame);
}
