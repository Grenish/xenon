"use client";

import { useEffect, useRef } from "react";
import { XenonMark } from "./logo";
import { createShaderProgram } from "./shader-program";

const vertex = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float time;
uniform vec3 pointer;
out vec4 color;

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 p = vec2(uv.x * size.x / size.y, uv.y);
  vec2 delta = (uv - pointer.xy) * vec2(size.x / size.y, 1.0);
  float touch = pointer.z * exp(-9.0 * dot(delta, delta));

  // A continuous cut crosses both letters. Its grooves bunch up as the
  // surface turns, catching a narrow highlight along each crest.
  float cut = 0.65 * p.x + 0.43 * p.y
    + 0.23 * sin(2.9 * p.x - 2.2 * p.y + 0.18 * sin(time * 0.21))
    + 0.08 * sin(4.1 * p.y + 0.6 * p.x) + 0.045 * touch;
  float phase = cut * 7.2 - 0.38 * time;
  float reflection = 0.5 + 0.5 * cos(phase);
  float crest = pow(reflection, 5.0);
  float groove = cut * 105.0;
  float width = max(fwidth(groove), 0.001);
  float line = 1.0 - smoothstep(0.02, 0.06 + width, abs(fract(groove) - 0.5));
  line *= 1.0 - smoothstep(0.35, 0.9, width);

  vec3 petrol = vec3(0.13, 0.34, 0.39);
  vec3 silver = vec3(0.78, 0.85, 0.86);
  vec3 paper = vec3(0.95, 0.97, 0.98);
  vec3 metal = mix(petrol, silver, smoothstep(0.02, 0.83, reflection));
  metal = mix(metal, paper, crest);
  metal = mix(metal, petrol * 0.75, line * (0.34 - 0.18 * crest));
  color = vec4(mix(metal, paper, 0.34 * touch), 1.0);
}`;

export function FooterMark() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const cover = host?.closest("footer")?.previousElementSibling;
    if (!canvas || !host || !cover) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let time: WebGLUniformLocation | null = null;
    let pointer: WebGLUniformLocation | null = null;
    let size: WebGLUniformLocation | null = null;
    let x = 0, y = 0, hover = 0;
    let visible = false, dirty = true, last = 0, elapsed = 0, frame = 0;

    function draw(now: number) {
      frame = 0;
      if (!visible || !gl || !program) return;
      if (dirty || now - last >= 1000 / 30 - 0.5) {
        elapsed += last ? Math.min(now - last, 100) / 1000 : 0;
        last = now;
        gl.uniform1f(time, motion.matches ? 0 : elapsed);
        gl.uniform3f(pointer, x, y, motion.matches ? 0 : hover);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!canvas!.hasAttribute("data-ready")) canvas!.dataset.ready = "";
        dirty = false;
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    }

    function layout() {
      if (!visible) return;
      if (!gl) {
        gl = canvas!.getContext("webgl2", { depth: false, antialias: false, powerPreference: "low-power" });
        if (!gl) return;
        program = createShaderProgram(gl, vertex, fragment);
        if (!program) return;
        gl.useProgram(program);
        time = gl.getUniformLocation(program, "time");
        size = gl.getUniformLocation(program, "size");
        pointer = gl.getUniformLocation(program, "pointer");
      }
      if (!program) return;
      const { width, height } = host!.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio, 1.5, 1600 / Math.max(1, width));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      if (canvas!.width !== w) canvas!.width = w;
      if (canvas!.height !== h) canvas!.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(size, w, h);
      dirty = true;
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function visibility() {
      // The sticky footer is inside the viewport even while the main page covers it.
      const rect = host!.getBoundingClientRect();
      const exposed = !document.hidden && Math.min(rect.bottom, innerHeight)
        > Math.max(0, rect.top, cover!.getBoundingClientRect().bottom);
      if (visible === exposed) return;
      visible = exposed;
      cancelAnimationFrame(frame);
      frame = last = hover = 0;
      layout();
    }

    function track(e: PointerEvent) {
      if (!visible || motion.matches || !e.isPrimary) return;
      const rect = host!.getBoundingClientRect();
      x = (e.clientX - rect.left) / rect.width;
      y = 1 - (e.clientY - rect.top) / rect.height;
      hover = 1;
      dirty = true;
    }
    function leave() {
      hover = 0;
      dirty = true;
    }
    function lost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = last = 0;
      program = null;
      delete canvas!.dataset.ready;
    }
    function restore() {
      gl = null;
      layout();
    }

    const resize = new ResizeObserver(() => { visibility(); layout(); });
    resize.observe(host);
    resize.observe(cover);
    const events = new AbortController();
    const options = { passive: true, signal: events.signal };
    window.addEventListener("scroll", visibility, options);
    document.addEventListener("visibilitychange", visibility, options);
    motion.addEventListener("change", layout, options);
    host.addEventListener("pointermove", track, options);
    host.addEventListener("pointerdown", track, options);
    host.addEventListener("pointerleave", leave, options);
    host.addEventListener("pointercancel", leave, options);
    canvas.addEventListener("webglcontextlost", lost, { signal: events.signal });
    canvas.addEventListener("webglcontextrestored", restore, options);
    visibility();
    return () => {
      events.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
      gl?.deleteProgram(program);
      delete canvas.dataset.ready;
    };
  }, []);

  return (
    <div className="relative">
      <XenonMark className="block h-auto w-full text-paper" title="Xenon" />
      <canvas
        ref={ref}
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-0 size-full data-ready:visible forced-colors:hidden"
        style={{ mask: "url('/xe-logo.svg') center / 100% 100% no-repeat" }}
      />
    </div>
  );
}
