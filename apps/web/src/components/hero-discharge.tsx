"use client";

import { useEffect, useRef } from "react";

const WAVES = 4;
const SPENT = new Float32Array(WAVES * 3);
for (let i = 2; i < SPENT.length; i += 3) SPENT[i] = 2;

const vertex = `
precision highp float;
attribute vec3 strand; // longitudinal position, strand number, side of stroke
uniform vec2 size;
uniform float time;
uniform vec3 pointer;
uniform vec3 waves[${WAVES}]; // xy: click origin, z: age in seconds
varying vec2 uv;
varying float side;
varying float charge;
varying float lane;
varying float registration;

float spine(float x, float mobile) {
  float bend = sin(5.3 * x + 0.27 * sin(time * 0.23));
  return mix(0.66 + 0.11 * bend - 0.31 * smoothstep(0.48, 1.04, x),
             0.54 + 0.065 * bend - 0.08 * x, mobile);
}

vec3 sheet(float u, float v, float mobile) {
  float span = mix(0.205, 0.14, mobile);
  float twist = 5.7 * u - 0.55 + 0.29 * sin(time * 0.19) + 0.18 * v;
  float shear = sin(twist);
  float x = u + 0.075 * v * shear;
  float y = spine(u, mobile) + span * v * cos(twist)
          + (1.0 - v * v) * 0.082 * sin(7.3 * u + 1.1 * v - 0.14 * time);
  // The same strands leaving the fold resolve into a ruled register on the right.
  float ruled = smoothstep(0.63, 0.94, u + 0.038 * sin(time * 0.16));
  y = mix(y, mix(0.37, 0.46, mobile) + v * span, ruled);
  return vec3(x, y, ruled);
}

void main() {
  float mobile = 1.0 - smoothstep(0.77, 1.25, size.x / size.y);
  vec2 metric = size / min(size.x, size.y);
  float u = strand.x;
  float v = strand.y;
  side = strand.z;
  lane = v;

  if (v > 1.5) {
    vec3 wave = waves[int(v) - 2];
    if (wave.z >= 1.55) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }
    float radius = wave.z * 0.66;
    float decay = 1.0 - smoothstep(0.26, 1.55, wave.z);
    float a = u * 6.2831853;
    vec2 normal = vec2(cos(a), sin(a));
    uv = wave.xy + normal * radius / metric;
    uv += normal * side * 1.8 / size;
    charge = decay * smoothstep(0.0, 0.08, wave.z) * (0.43 + 0.22 * cos(a * 2.0 + wave.z));
    registration = 0.0;
  } else {
    vec3 field = sheet(u, v, mobile);
    vec2 p = field.xy;
    registration = field.z;
    vec2 tangent = normalize((sheet(u + 0.002, v, mobile).xy - p) * size);
    vec2 normal = vec2(-tangent.y, tangent.x);
    vec2 delta = (p - pointer.xy) * metric;
    float touch = pointer.z * exp(-dot(delta, delta) * 8.0);
    p.y += touch * (pointer.y - p.y) * 0.59;
    p.x -= touch * delta.y * 0.08;
    vec2 displacement = vec2(0.0);
    float front = 0.0;
    for (int i = 0; i < ${WAVES}; ++i) {
      vec3 wave = waves[i];
      if (wave.z >= 1.55) continue;
      vec2 offset = (p - wave.xy) * metric;
      float dist = length(offset);
      float band = 1.0 - smoothstep(0.0, 0.086, abs(dist - wave.z * 0.66));
      float strength = band * (1.0 - smoothstep(0.26, 1.55, wave.z));
      displacement += (offset / max(0.015, dist)) * strength;
      front += (1.0 - front) * strength;
    }
    p += 0.031 * displacement * (1.5 / max(1.5, length(displacement))) / metric;

    float light = 0.5 + 0.5 * cos(11.0 * u - 3.7 * v + 1.5 * sin(5.7 * u - 0.55) - 0.62 * time);
    float glint = light * light * light;
    charge = 0.19 + 0.40 * glint + 0.16 * (0.5 + 0.5 * v) + 0.7 * touch + 0.95 * front;
    uv = p + normal * side * mix(1.0, 1.8, clamp(touch + front + glint * 0.35, 0.0, 1.0)) / size;
  }
  gl_Position = vec4(uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

const fragment = `
precision mediump float;
uniform vec4 copyBounds[3];
varying vec2 uv;
varying float side;
varying float charge;
varying float lane;
varying float registration;

float outsideCopy(vec4 rect) {
  vec2 d = max(max(rect.xy - uv, uv - rect.zw), 0.0);
  return smoothstep(0.0, 0.067, max(d.x, d.y));
}

void main() {
  vec3 ink = vec3(12., 13., 15.) / 255.;
  vec3 glow = vec3(95., 180., 200.) / 255.;
  vec3 ice = vec3(236., 238., 240.) / 255.;
  float quiet = min(outsideCopy(copyBounds[0]), min(outsideCopy(copyBounds[1]), outsideCopy(copyBounds[2])));
  quiet *= smoothstep(0.055, 0.15, uv.y) * (1.0 - smoothstep(0.93, 1.0, uv.y));
  float cov = 1.0 - smoothstep(0.12, 1.0, abs(side));
  // On the ruled side, small interruptions line up across adjacent rows.
  float ticks = smoothstep(0.02, 0.15, abs(fract(uv.x * 30.0) - 0.5));
  cov *= mix(1.0, ticks, registration * 0.88);
  vec3 light = mix(glow, ice, smoothstep(0.59, 1.48, charge) * 0.64);
  float power = min(charge * 0.83, 1.0) * mix(0.18, 1.0, quiet);
  gl_FragColor = vec4(mix(ink, light, power), cov * (lane > 1.5 ? charge : 0.88));
}
`;

// One static triangle strip. Degenerate triangles join adjacent hairlines without
// connecting them visually. The final four lanes draw the individual pressure fronts.
function makeStrands() {
  const count = 53, steps = 136;
  const lines = count + WAVES;
  const data = new Float32Array(3 * (lines * (steps + 1) * 2 + (lines - 1) * 2));
  let at = 0;
  for (let line = 0; line < lines; line++) {
    const ring = line >= count;
    const lane = ring ? 2 + line - count : line * 2 / (count - 1) - 1;
    for (let j = 0; j <= steps; j++) {
      const u = ring ? j / steps : j / steps * 1.30 - 0.15;
      if (line > 0 && j === 0) {
        data.copyWithin(at, at - 3, at); at += 3;
        data[at++] = u; data[at++] = lane; data[at++] = -1;
      }
      for (let side = -1; side <= 1; side += 2) {
        data[at++] = u; data[at++] = lane; data[at++] = side;
      }
    }
  }
  return data;
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function makeRenderer(gl: WebGLRenderingContext) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (vs && fs && program) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  if (!buffer) { gl.deleteProgram(program); return null; }
  const data = makeStrands();
  const vertices = data.length / 3;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "strand");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(12 / 255, 13 / 255, 15 / 255, 1);
  const size = gl.getUniformLocation(program, "size");
  const time = gl.getUniformLocation(program, "time");
  const pointer = gl.getUniformLocation(program, "pointer");
  const waveLocations = gl.getUniformLocation(program, "waves[0]");
  const bounds = gl.getUniformLocation(program, "copyBounds[0]");
  return {
    resize(rects: Float32Array) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(size, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform4fv(bounds, rects);
    },
    draw(t: number, x: number, y: number, presence: number, waves: Float32Array) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(time, t);
      gl.uniform3f(pointer, x, y, presence);
      gl.uniform3fv(waveLocations, waves);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices);
    },
    dispose() { gl.deleteBuffer(buffer); gl.deleteProgram(program); },
  };
}

export function HeroDischarge() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, powerPreference: "low-power" };
    const modern = canvas.getContext("webgl2", options);
    const gl: WebGLRenderingContext | null = modern ?? canvas.getContext("webgl", options);
    if (!gl) return;

    let renderer = makeRenderer(gl);
    if (!renderer) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const copy = Array.from(host.querySelectorAll<HTMLElement>("h1 .mask-line > span, p")).slice(0, 3);
    const rects = new Float32Array(12);
    const range = document.createRange();
    let disposed = false, visible = false, raf = 0, last = 0, clock = 2.4;
    let pointerX = 0.5, pointerY = 0.5, x = 0.5, y = 0.5, presence = 0, target = 0;
    const waves = SPENT.slice();
    let firstCandidate = 0;
    let dirty = true, shown = false;

    function draw(now: number) {
      raf = 0;
      if (disposed || !visible || document.hidden || !renderer) return;
      const dt = last ? (now - last) / 1000 : 0;
      if (dirty || dt >= 1 / 30 || !last) {
        last = now;
        const still = motion.matches;
        const step = Math.min(dt, 0.12);
        const ease = 1 - Math.exp(-9 * step);
        x += (pointerX - x) * ease;
        y += (pointerY - y) * ease;
        presence += (target - presence) * ease;
        clock += step;
        for (let i = 2; i < waves.length; i += 3) waves[i] = Math.min(2, waves[i]! + step);
        renderer.draw(still ? 2.4 : clock, x, y, still ? 0 : presence, still ? SPENT : waves);
        dirty = false;
        if (!shown) { shown = true; canvas!.dataset.on = ""; }
      }
      if (!motion.matches) raf = requestAnimationFrame(draw);
    }
    function schedule() {
      if (!disposed && renderer && visible && !document.hidden && !raf && (!motion.matches || dirty)) {
        raf = requestAnimationFrame(draw);
      }
    }
    function pause() {
      cancelAnimationFrame(raf); raf = 0; last = 0;
    }
    function layout() {
      if (disposed || !renderer) return;
      const r = host!.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const scale = Math.min(devicePixelRatio, 1.5, Math.sqrt(1150000 / (r.width * r.height)));
      const width = Math.max(1, Math.round(r.width * scale)), height = Math.max(1, Math.round(r.height * scale));
      if (canvas!.width !== width) canvas!.width = width;
      if (canvas!.height !== height) canvas!.height = height;
      // Measure the ink's final position, independent of the animated span's entrance transform.
      for (let i = 0; i < 3; i++) {
        const el = copy[i];
        if (!el) { rects.fill(-2, i * 4, i * 4 + 4); continue; }
        range.selectNodeContents(el);
        const glyphs = range.getBoundingClientRect();
        const shift = el.parentElement!.getBoundingClientRect().top - el.getBoundingClientRect().top;
        const dy = el.tagName === "SPAN" ? shift : 0;
        rects[i * 4] = (glyphs.left - r.left) / r.width;
        rects[i * 4 + 1] = (glyphs.top + dy - r.top) / r.height;
        rects[i * 4 + 2] = (glyphs.right - r.left) / r.width;
        rects[i * 4 + 3] = (glyphs.bottom + dy - r.top) / r.height;
      }
      renderer.resize(rects); dirty = true; schedule();
    }
    function visibility() {
      pause();
      if (document.hidden || !visible) { target = 0; presence = 0; }
      schedule();
    }
    function preference() {
      waves.set(SPENT);
      dirty = true; target = 0; presence = 0; visibility();
    }
    function move(e: PointerEvent) {
      if (motion.matches) return;
      const r = host!.getBoundingClientRect();
      pointerX = (e.clientX - r.left) / r.width;
      pointerY = (e.clientY - r.top) / r.height;
      target = 1;
    }
    function leave() { target = 0; }
    function click(e: MouseEvent) {
      if (motion.matches || (e.target instanceof Element && e.target.closest("a,button,input"))) return;
      const r = host!.getBoundingClientRect();
      // Search by age. Starting after the previous write breaks ties in arrival
      // order when several clicks land between two rendered frames.
      let oldest = firstCandidate;
      for (let i = 1; i < WAVES; i++) {
        const slot = (firstCandidate + i) % WAVES;
        if (waves[slot * 3 + 2]! > waves[oldest * 3 + 2]!) oldest = slot;
      }
      const offset = oldest * 3;
      waves[offset] = (e.clientX - r.left) / r.width;
      waves[offset + 1] = (e.clientY - r.top) / r.height;
      waves[offset + 2] = 0;
      firstCandidate = (oldest + 1) % WAVES;
    }
    function lost(e: Event) {
      e.preventDefault(); pause(); renderer = null;
      shown = false; delete canvas!.dataset.on;
    }
    function restored() {
      if (disposed) return;
      renderer = makeRenderer(gl!);
      layout();
    }
    const resize = new ResizeObserver(layout);
    const viewport = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visibility(); });
    const listeners = new AbortController();
    const events = { signal: listeners.signal };
    host.addEventListener("pointermove", move, events);
    host.addEventListener("pointerleave", leave, events);
    host.addEventListener("pointercancel", leave, events);
    host.addEventListener("click", click, events);
    canvas.addEventListener("webglcontextlost", lost, events);
    canvas.addEventListener("webglcontextrestored", restored, events);
    document.addEventListener("visibilitychange", visibility, events);
    motion.addEventListener("change", preference, events);
    resize.observe(host); viewport.observe(host);
    layout();
    document.fonts.ready.then(layout);
    return () => {
      disposed = true; pause(); listeners.abort();
      resize.disconnect(); viewport.disconnect(); renderer?.dispose();
      delete canvas.dataset.on;
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 size-full opacity-0 transition-opacity duration-700 motion-reduce:transition-none data-on:opacity-100" />;
}
