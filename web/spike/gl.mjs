// Minimal WebGL2 helpers for the visual spike. No dependencies.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw Error('WebGL2 indisponível neste navegador');
  const floatRT = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  return { gl, floatRT };
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n');
    throw Error(`Shader ${label} não compilou:\n${log}\n${numbered}`);
  }
  return sh;
}

export function program(gl, vs, fs, label = 'program') {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, label + '.vs'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + '.fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(`Programa ${label} não linkou: ${gl.getProgramInfoLog(p)}`);
  const cache = new Map();
  const loc = name => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name);
  };
  return {
    p, loc,
    use() { gl.useProgram(p); return this; },
    f(name, ...v) { const l = loc(name); if (l) gl[`uniform${v.length}f`](l, ...v); return this; },
    i(name, v) { const l = loc(name); if (l) gl.uniform1i(l, v); return this; },
    v3(name, arr) { const l = loc(name); if (l) gl.uniform3fv(l, arr); return this; },
    v4(name, arr) { const l = loc(name); if (l) gl.uniform4fv(l, arr); return this; },
    m3(name, arr) { const l = loc(name); if (l) gl.uniformMatrix3fv(l, false, arr); return this; },
    m4(name, arr) { const l = loc(name); if (l) gl.uniformMatrix4fv(l, false, arr); return this; },
    tex(name, unit, texture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); return this.i(name, unit); },
  };
}

/** Render target with a texture attachment. */
export function target(gl, w, h, { float = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); } };
}

/** Multisampled colour + depth buffer, resolved into a texture target with resolveTo(). */
export function msaaTarget(gl, w, h, samples = 4) {
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  const max = gl.getParameter(gl.MAX_SAMPLES);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(samples, max), gl.RGBA8, w, h);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(samples, max), gl.DEPTH_COMPONENT24, w, h);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    fbo, w, h,
    resolveTo(dst) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst ? dst.fbo : null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, dst ? dst.w : w, dst ? dst.h : h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    },
    dispose() { gl.deleteRenderbuffer(rb); gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(fbo); },
  };
}

/** Interleaved float vertex buffer + index buffer in a VAO. layout = [[location, size], ...]. */
export function mesh(gl, vertices, indices, layout) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
  let offset = 0;
  for (const [location, size] of layout) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    offset += size * 4;
  }
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    count: indices.length,
    draw() { gl.bindVertexArray(vao); gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0); },
    dispose() { gl.deleteBuffer(vbo); gl.deleteBuffer(ibo); gl.deleteVertexArray(vao); },
  };
}

/** Grid indices for a (cols x rows) vertex lattice, row-major. */
export function gridIndices(cols, rows, base = 0) {
  const out = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    out.push(a, b, c, b, d, c);
  }
  return out;
}

// ---- small mat4 helpers (column-major, like GLSL) ----
export const mat4 = {
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  /** translate * rotY(yaw) * rotZ(pitch) * scale(sx, s, s) */
  model([tx, ty, tz], yaw, pitch, scale, mirror) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry * Rz
    const r = [cy * cp, sp, -sy * cp, -cy * sp, cp, sy * sp, sy, 0, cy];
    const sx = scale * mirror;
    return new Float32Array([
      r[0] * sx, r[1] * sx, r[2] * sx, 0,
      r[3] * scale, r[4] * scale, r[5] * scale, 0,
      r[6] * scale, r[7] * scale, r[8] * scale, 0,
      tx, ty, tz, 1,
    ]);
  },
  normalFromModel(m, scale) {
    // rotation * mirror (orthogonal), so the inverse-transpose equals the normalized 3x3 block.
    const k = 1 / scale;
    return new Float32Array([m[0] * k, m[1] * k, m[2] * k, m[4] * k, m[5] * k, m[6] * k, m[8] * k, m[9] * k, m[10] * k]);
  },
};
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
