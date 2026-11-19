"use client";

import { useEffect, useRef } from "react";

/**
 * "Runs on what you own", as a background: loose xenon filaments drift in from the far side of the
 * section, braid into four bundles and land as ruled, parallel rows right beside the four groups of the
 * list (Data, Files, People, Delivery). Everything flows into what you own.
 *
 * The list drives it: hovering or focusing a row lights that row's strand and its bundle while the other
 * bundles step back, in time with the list's own dimming. The pointer draws loose strands toward it, and
 * a click sends a pressure front through the field. Same language as the hero's filaments
 * (hero-discharge.tsx): one static strip, one draw call, 30 fps cap, quiet behind the copy.
 *
 * Contract with page.tsx: the canvas is the first child of `[data-stack-section]` (relative isolate);
 * the list is `.stack-list`, groups are its `ul`s, rows are `[data-stack-row][data-stack-group]`.
 */

const GROUPS = 4;
const PER = 14;
const COUNT = GROUPS * PER;
const STEPS = 120;
const QUIET = 7;
const WAVES = 4; // clicks that can ripple at once
/** Every wave slot spent: what reduced motion draws with. */
const SPENT = new Float32Array(Array.from({ length: WAVES * 3 }, (_, i) => (i % 3 === 2 ? 2 : 0))); // heading, four row blocks, the paragraph, spare

const vertex = `
precision highp float;
attribute vec3 strand; // position along the strand, strand number, side of the stroke
uniform vec2 size;
uniform float time;
uniform vec3 pointer;   // xy (0..1, top-down), presence
uniform vec3 waves[${WAVES}]; // each click: origin, seconds since (2 or more = spent)
uniform vec4 anchorY;   // each group's row block: centre
uniform vec4 anchorH;   // and half-height
uniform float anchorX;  // where the bundles land
uniform vec4 gaps;      // narrow layout: centres of the spaces before the group headings
uniform mediump vec2 formatInfo;    // narrow layout flag, space above the section title
uniform float pulseAge; // seconds since entering the active row
uniform vec4 level;     // each bundle's brightness
uniform vec2 focus;     // active group (-1 none), active row's lane
varying vec2 uv;
varying float side;
varying float charge;
varying float registration;
varying float coverage;

float pick(vec4 a, float g) { return g < 0.5 ? a.x : g < 1.5 ? a.y : g < 2.5 ? a.z : a.w; }

// Rotate each sheet's cross section. Its projected width collapses edge-on,
// then opens the other way; adjacent sheets pass through different depths.
vec3 fold(float u, float g, float v) {
  float turn = 6.9 * u - 0.78 * g + 0.38 * sin(0.22 * time + g);
  float twist = turn + 0.44 * v * sin(3.8 * u + g);
  float depth = sin(twist) * v;
  float y = 0.5 + 0.22 * sin(5.4 * u + 1.59 * g + 0.18 * sin(0.31 * time))
            + 0.115 * sin(8.1 * u - 0.73 * g - 0.12 * time)
            + 0.148 * v * cos(twist)
            + 0.067 * (1.0 - v * v) * sin(8.7 * u + g + 0.19 * time);
  return vec3(0.054 * depth + 0.022 * sin(8.5 * u + g), y, depth);
}

vec3 path(float u, float g, float v) {
  float free = smoothstep(0.12, 0.66, u);
  vec3 gas = fold(u, g, v);
  if (formatInfo.x > 0.5) {
    // Follow the strand inward: across the title band, around the right-hand
    // bleed, then back onto the page in the gap immediately above its group.
    float landing = clamp(u / 0.40, 0.0, 1.0);
    float source = clamp((u - 0.48) / 0.52, 0.0, 1.0);
    float x = mix(0.06 + 0.032 * v * v, 1.16, landing) - source * 1.25;
    float gap = pick(gaps, g);
    float band = formatInfo.y * (0.02 + 0.95 * gas.y);
    float sweep = smoothstep(0.23, 0.95, landing);
    float landingY = gap + (v * (0.089 + 0.053 * sweep) +
       sweep * 0.055 * sin(6.3 * landing + 0.8 * g + 0.24 * time)) * formatInfo.y;
    return vec3(x + gas.x * source, mix(landingY, band, smoothstep(0.40, 0.48, u)), gas.z);
  }
  float landing = pick(anchorY, g) + v * pick(anchorH, g) * 0.82;
  float x = mix(anchorX, 1.08, u) + free * gas.x;
  return vec3(x, mix(landing, gas.y, free), free * gas.z);
}

void main() {
  float i = strand.y;
  float g = floor(i / ${PER}.0);
  float v = mod(i, ${PER}.0) / ${PER - 1}.0 * 2.0 - 1.0;
  float u = strand.x;
  side = strand.z;
  vec2 metric = size / min(size.x, size.y);
  vec3 field = path(u, g, v);
  vec2 p = field.xy;
  vec2 tangent = normalize((path(u + 0.002, g, v).xy - p) * size + vec2(0.00001, 0.0));
  vec2 normal = vec2(-tangent.y, tangent.x);
  // Landed strands are a register: straight, parallel, interrupted
  registration = 1.0 - smoothstep(0.03, 0.2, u);

  vec2 d = (p - pointer.xy) * metric;
  float touch = pointer.z * exp(-dot(d, d) * 9.0) * (1.0 - registration);
  p += (pointer.xy - p) * touch * 0.3;

  // Every click keeps its own front until it has played out. Pushes add up, capped so crossing fronts
  // can't tear the strands; light combines softly, so two fronts brighten without blowing out.
  vec2 push = vec2(0.0);
  float dark = 1.0;
  for (int k = 0; k < ${WAVES}; k++) {
    vec3 w = waves[k];
    vec2 offset = (p - w.xy) * metric;
    float dist = length(offset);
    float decay = 1.0 - smoothstep(0.25, 1.6, w.z);
    float f = (1.0 - smoothstep(0.0, 0.09, abs(dist - w.z * 0.7))) * decay;
    push += (offset / max(0.015, dist)) * (0.028 * f);
    dark *= 1.0 - f;
  }
  push *= min(1.0, 0.042 / max(length(push), 0.00001));
  p += push / metric;
  float front = 1.0 - dark;

  // Light travels inward, from the far side toward the list
  float phase = 10.2 * u + 1.42 * time + g * 1.81 + v * 0.77 + 0.3 * sin(0.27 * time + g);
  float crest = 0.5 + 0.5 * cos(phase);
  float glint = crest * crest * crest * crest;
  float depth = 0.70 + 0.23 * field.z;
  float rowDistance = abs(focus.y - v);
  float inGroup = 1.0 - step(0.5, abs(focus.x - g));
  float row = inGroup * (1.0 - smoothstep(0.03, 0.11, rowDistance));
  float behindHead = u - (1.07 - pulseAge * 1.83);
  float packet = smoothstep(-0.055, 0.0, behindHead) * (1.0 - smoothstep(0.0, 0.21, behindHead));
  packet *= inGroup * (1.0 - smoothstep(0.0, 0.38, rowDistance));
  charge = (0.29 + 0.94 * glint + 0.09 * registration) * depth * pick(level, g)
         + row * 0.56 + 2.10 * packet + 0.66 * touch + 1.2 * front;
  float width = 1.10 + 0.46 * glint + 0.52 * touch + 0.65 * row + 2.30 * packet + 1.35 * front;
  // Thin out the unfocused narrow-screen ribbons so their separate threads
  // survive the short gaps between headings. Every row can still light its lane.
  float mobileThread = mod(i, 3.0) < 0.5 ? 0.95 : 0.14;
  coverage = mix(1.0, max(mobileThread, max(row, packet)), formatInfo.x);
  uv = p + normal * side * width / size;
  gl_Position = vec4(uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

const fragment = `
precision mediump float;
uniform mediump vec2 formatInfo;
uniform vec4 quiet[${QUIET}];
varying vec2 uv;
varying float side;
varying float charge;
varying float registration;
varying float coverage;

float outside(vec4 r) {
  vec2 d = max(max(r.xy - uv, uv - r.zw), 0.0);
  return smoothstep(0.0, mix(0.04, 0.012, formatInfo.x), max(d.x, d.y));
}

void main() {
  vec3 ink = vec3(12., 13., 15.) / 255.;
  vec3 glow = vec3(95., 180., 200.) / 255.;
  vec3 ice = vec3(236., 238., 240.) / 255.;
  float q = 1.0;
  for (int k = 0; k < ${QUIET}; k++) q = min(q, outside(quiet[k]));
  // Fade in and out at the section's top and bottom, so it never meets a hard edge
  float edge = smoothstep(0.0, mix(0.10, 0.012, formatInfo.x), uv.y) * (1.0 - smoothstep(0.88, 1.0, uv.y));
  float cov = 1.0 - smoothstep(0.12, 1.0, abs(side));
  float ticks = smoothstep(0.02, 0.15, abs(fract(uv.x * 34.0) - 0.5));
  cov *= mix(1.0, ticks, registration * 0.85);
  vec3 light = mix(glow, ice, smoothstep(0.6, 1.5, charge) * 0.64);
  float power = min(charge * 0.83, 1.0) * mix(0.12, 1.0, q);
  gl_FragColor = vec4(mix(ink, light, power), cov * 0.88 * edge * coverage);
}
`;

function makeStrands() {
  const data = new Float32Array(3 * (COUNT * (STEPS + 1) * 2 + (COUNT - 1) * 2));
  let at = 0;
  for (let line = 0; line < COUNT; line++) {
    for (let j = 0; j <= STEPS; j++) {
      const u = (j / STEPS) * 1.08 - 0.02;
      if (line > 0 && j === 0) {
        // Degenerate join: repeat the last vertex, then the first of this strand
        data.copyWithin(at, at - 3, at);
        at += 3;
        data[at++] = u;
        data[at++] = line;
        data[at++] = -1;
      }
      for (let side = -1; side <= 1; side += 2) {
        data[at++] = u;
        data[at++] = line;
        data[at++] = side;
      }
    }
  }
  return data.subarray(0, at);
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

type Frame = {
  t: number;
  px: number;
  py: number;
  presence: number;
  waves: Float32Array;
  level: Float32Array;
  group: number;
  lane: number;
  pulseAge: number;
};

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
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
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
  const at = (n: string) => gl.getUniformLocation(program, n);
  const U = {
    size: at("size"),
    time: at("time"),
    pointer: at("pointer"),
    waves: at("waves[0]"),
    anchorY: at("anchorY"),
    anchorH: at("anchorH"),
    anchorX: at("anchorX"),
    level: at("level"),
    focus: at("focus"),
    pulseAge: at("pulseAge"),
    gaps: at("gaps"),
    formatInfo: at("formatInfo"),
    quiet: at("quiet[0]"),
  };
  return {
    resize(anchorY: Float32Array, anchorH: Float32Array, anchorX: number, quiet: Float32Array, gaps: Float32Array, narrow: boolean, titleTop: number) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(U.size, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform4fv(U.anchorY, anchorY);
      gl.uniform4fv(U.anchorH, anchorH);
      gl.uniform1f(U.anchorX, anchorX);
      gl.uniform4fv(U.quiet, quiet);
      gl.uniform4fv(U.gaps, gaps);
      gl.uniform2f(U.formatInfo, narrow ? 1 : 0, titleTop);
    },
    draw(f: Frame) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.time, f.t);
      gl.uniform3f(U.pointer, f.px, f.py, f.presence);
      gl.uniform3fv(U.waves, f.waves);
      gl.uniform4fv(U.level, f.level);
      gl.uniform2f(U.focus, f.group, f.lane);
      gl.uniform1f(U.pulseAge, f.pulseAge);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

const GROUP_INDEX: Record<string, number> = { data: 0, files: 1, people: 2, delivery: 3 };

/** An element's box in the host's coordinates from layout offsets, so the rows' rise-in transform
 * doesn't skew the measurement. */
function box(el: HTMLElement, host: HTMLElement) {
  let left = 0, top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== host) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

export function StackField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const list = host?.querySelector<HTMLElement>(".stack-list");
    if (!canvas || !host || !list) return;
    const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, powerPreference: "low-power" };
    const gl: WebGLRenderingContext | null = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
    if (!gl) return;
    let renderer = makeRenderer(gl);
    if (!renderer) return;

    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const blocks = Array.from(list.querySelectorAll<HTMLElement>("ul")).slice(0, GROUPS);
    const column = list.parentElement!;
    const title = column.querySelector("h2");
    const quietEls = [title, ...blocks.map(b => b.parentElement), column.querySelector(":scope > p")].filter(
      (el): el is HTMLElement => !!el,
    );
    const anchorY = new Float32Array(4);
    const gaps = new Float32Array(GROUPS);
    const anchorH = new Float32Array(4);
    const quiet = new Float32Array(QUIET * 4).fill(-2);
    const level = new Float32Array([1, 1, 1, 1]);
    const levelTarget = new Float32Array([1, 1, 1, 1]);
    const waves = SPENT.slice();
    const frame: Frame = { t: 3, px: 0.5, py: 0.5, presence: 0, waves, level, group: -1, lane: 0, pulseAge: 2 };
    let activeRow: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let disposed = false;
    let visible = false;
    let raf = 0;
    let last = 0;
    let clock = 3;
    let dirty = true;
    let shown = false;
    let px = 0.5, py = 0.5, x = 0.5, y = 0.5, presence = 0, target = 0;
    let pulseAge = 2;

    function layout() {
      if (disposed || !renderer) return;
      const r = host!.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const scale = Math.min(devicePixelRatio, 1.5, Math.sqrt(1150000 / (r.width * r.height)));
      const width = Math.max(1, Math.round(r.width * scale));
      const height = Math.max(1, Math.round(r.height * scale));
      if (canvas!.width !== width) canvas!.width = width;
      if (canvas!.height !== height) canvas!.height = height;
      const titleBox = title ? box(title, host!) : { top: 0, bottom: 0 };
      let previousBottom = titleBox.bottom;
      blocks.forEach((b, i) => {
        const br = box(b, host!);
        anchorY[i] = (br.top + br.height / 2) / r.height;
        anchorH[i] = br.height / 2 / r.height;
        const blockTop = box(b.parentElement ?? b, host!).top;
        gaps[i] = (previousBottom + blockTop) * 0.5 / r.height;
        previousBottom = br.bottom;
      });
      const cr = box(column, host!);
      const right = cr.right / r.width;
      const narrow = right > 0.72;
      const anchorX = right + 0.028;
      quiet.fill(-2);
      quietEls.slice(0, QUIET).forEach((el, i) => {
        const er = box(el, host!);
        quiet[i * 4] = er.left / r.width;
        quiet[i * 4 + 1] = er.top / r.height;
        quiet[i * 4 + 2] = er.right / r.width;
        quiet[i * 4 + 3] = er.bottom / r.height;
      });
      renderer.resize(anchorY, anchorH, anchorX, quiet, gaps, narrow, titleBox.top / r.height);
      dirty = true;
      schedule();
    }

    function draw(now: number) {
      raf = 0;
      if (disposed || !visible || document.hidden || !renderer) return;
      const still = motion.matches;
      const dt = last ? (now - last) / 1000 : 0;

      if (dirty || dt >= 1 / 30 || !last) {
        last = now;
        const step = Math.min(dt, 0.12);
        const ease = still ? 1 : 1 - Math.exp(-9 * step);
        x += (px - x) * ease;
        y += (py - y) * ease;
        presence += (target - presence) * ease;
        for (let i = 0; i < 4; i++) {
          level[i]! += (levelTarget[i]! - level[i]!) * ease;
        }
        clock += step;
        for (let k = 2; k < waves.length; k += 3) waves[k] = Math.min(2, waves[k]! + step);
        pulseAge = Math.min(2, pulseAge + dt);
        frame.t = still ? 3 : clock;
        frame.px = x;
        frame.py = y;
        frame.presence = still ? 0 : presence;
        frame.waves = still ? SPENT : waves;
        frame.pulseAge = still ? 2 : pulseAge;
        renderer.draw(frame);
        dirty = false;
        if (!shown) {
          shown = true;
          canvas!.dataset.on = "";
        }
      }
      if (!still) raf = requestAnimationFrame(draw);
    }
    function schedule() {
      if (!disposed && renderer && visible && !document.hidden && !raf && (!motion.matches || dirty)) {
        raf = requestAnimationFrame(draw);
      }
    }
    function pause() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }
    function visibility() {
      pause();
      if (document.hidden || !visible) {
        target = 0;
        presence = 0;
      }
      schedule();
    }

    // The list drives the bundles
    function activate(row: HTMLElement | null) {
      const g = row ? (GROUP_INDEX[row.dataset.stackGroup ?? ""] ?? -1) : -1;
      if (row === activeRow) return;
      activeRow = row;
      frame.group = g;
      pulseAge = row && !motion.matches ? 0 : 2;
      if (g >= 0 && row) {
        const r = host!.getBoundingClientRect();
        const rr = box(row, host!);
        const c = (rr.top + rr.height / 2) / r.height;
        const relative = Math.max(-1, Math.min(1, (c - anchorY[g]!) / (anchorH[g]! * 0.82 || 1)));
        frame.lane = 2 * Math.round((relative + 1) * 0.5 * (PER - 1)) / (PER - 1) - 1;
      }
      for (let i = 0; i < 4; i++) levelTarget[i] = g < 0 ? 1 : i === g ? 1.6 : 0.4;
      dirty = true;
      schedule();
    }
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-stack-row]") : null);
    function rowChange(e: Event) {
      const exiting = e.type === "pointerout" || e.type === "focusout";
      const row = rowOf(exiting ? (e as FocusEvent).relatedTarget : e.target);
      if (e.type.startsWith("focus")) focused = row;
      else hovered = row;
      activate(row ?? hovered ?? focused);
    }

    function move(e: PointerEvent) {
      if (motion.matches) return;
      const r = host!.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width;
      py = (e.clientY - r.top) / r.height;
      target = 1;
    }
    function leave() {
      target = 0;
    }
    function click(e: MouseEvent) {
      if (motion.matches || (e.target instanceof Element && e.target.closest("a,button,input,[data-stack-row]"))) return;
      const r = host!.getBoundingClientRect();
      // Take the slot whose ripple is oldest (or spent), so a young ripple is never the one cut short
      let slot = 0;
      for (let k = 1; k < WAVES; k++) if (waves[k * 3 + 2]! > waves[slot * 3 + 2]!) slot = k;
      waves[slot * 3] = (e.clientX - r.left) / r.width;
      waves[slot * 3 + 1] = (e.clientY - r.top) / r.height;
      waves[slot * 3 + 2] = 0;
    }
    function lost(e: Event) {
      e.preventDefault();
      pause();
      renderer = null;
      shown = false;
      delete canvas!.dataset.on;
    }
    function restored() {
      if (disposed) return;
      renderer = makeRenderer(gl!);
      layout();
    }

    const resize = new ResizeObserver(layout);
    const viewport = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      visibility();
    });
    const listeners = new AbortController();
    const opts = { signal: listeners.signal };
    host.addEventListener("pointermove", move, opts);
    host.addEventListener("pointerleave", leave, opts);
    host.addEventListener("pointercancel", leave, opts);
    host.addEventListener("click", click, opts);
    list.addEventListener("pointerover", rowChange, opts);
    list.addEventListener("pointerout", rowChange, opts);
    list.addEventListener("focusin", rowChange, opts);
    list.addEventListener("focusout", rowChange, opts);
    canvas.addEventListener("webglcontextlost", lost, opts);
    canvas.addEventListener("webglcontextrestored", restored, opts);
    document.addEventListener("visibilitychange", visibility, opts);
    motion.addEventListener("change", () => {
      dirty = true;
      waves.set(SPENT);
      pulseAge = 2;
      target = 0;
      presence = 0;
      visibility();
    }, opts);
    resize.observe(host);
    viewport.observe(host);
    layout();
    document.fonts.ready.then(layout);
    return () => {
      disposed = true;
      pause();
      listeners.abort();
      resize.disconnect();
      viewport.disconnect();
      renderer?.dispose();
      delete canvas.dataset.on;
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 size-full opacity-0 transition-opacity duration-700 motion-reduce:transition-none data-on:opacity-100"
    />
  );
}
