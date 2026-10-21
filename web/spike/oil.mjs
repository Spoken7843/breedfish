// Painterly post-process: structure tensor -> blur -> anisotropic Kuwahara + brush field -> impasto, canvas.
// settings.scale (0.5..1) runs the tensor, Kuwahara and brush passes at reduced resolution; the paint pass
// always runs at full resolution. Cost of the Kuwahara pass grows with radius^2 and with scale^2.
import { program, target } from './gl.mjs';
import { FULLSCREEN_VS, TENSOR_FS, BLUR_FS, KUWAHARA_FS, STROKE_FS, PAINT_FS, BLIT_FS } from './shaders.mjs';

export function createOil(gl, floatRT) {
  const progs = {
    tensor: program(gl, FULLSCREEN_VS, TENSOR_FS, 'tensor'),
    blur: program(gl, FULLSCREEN_VS, BLUR_FS, 'blur'),
    kuwahara: program(gl, FULLSCREEN_VS, KUWAHARA_FS, 'kuwahara'),
    strokes: program(gl, FULLSCREEN_VS, STROKE_FS, 'strokes'),
    paint: program(gl, FULLSCREEN_VS, PAINT_FS, 'paint'),
    blit: program(gl, FULLSCREEN_VS, BLIT_FS, 'blit'),
  };
  const vao = gl.createVertexArray();
  let rt = null;

  function resize(w, h, scale) {
    const sw = Math.max(64, Math.round(w * scale)), sh = Math.max(64, Math.round(h * scale));
    if (rt && rt.w === w && rt.h === h && rt.sw === sw && rt.sh === sh) return;
    if (rt) Object.values(rt.targets).forEach(t => t.dispose());
    rt = { w, h, sw, sh, targets: {
      tfmA: target(gl, sw, sh, { float: floatRT }),
      tfmB: target(gl, sw, sh, { float: floatRT }),
      kuw: target(gl, sw, sh),
      strokes: target(gl, sw, sh),
    } };
  }

  function pass(prog, dst, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, dst ? dst.w : rt.w, dst ? dst.h : rt.h);
    prog.use();
    setup(prog);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Paint `scene` (a texture target) to the default framebuffer. */
  function apply(scene, settings) {
    resize(scene.w, scene.h, settings.scale ?? 1);
    gl.disable(gl.BLEND);
    if (!settings.enabled) { pass(progs.blit, null, p => p.tex('uSrc', 0, scene.tex)); return; }
    const { tfmA, tfmB, kuw, strokes } = rt.targets;
    const small = [1 / rt.sw, 1 / rt.sh], full = [1 / rt.w, 1 / rt.h];
    const radius = Math.max(1.5, settings.radius * (settings.scale ?? 1));
    pass(progs.tensor, tfmA, p => p.tex('uSrc', 0, scene.tex).f('uTexel', ...small));
    pass(progs.blur, tfmB, p => p.tex('uSrc', 0, tfmA.tex).f('uDir', small[0] * 1.5, 0));
    pass(progs.blur, tfmA, p => p.tex('uSrc', 0, tfmB.tex).f('uDir', 0, small[1] * 1.5));
    pass(progs.kuwahara, kuw, p => p.tex('uSrc', 0, scene.tex).tex('uTfm', 1, tfmA.tex).f('uTexel', ...small)
      .f('uRadius', radius).f('uQ', 8).f('uAlpha', 1).f('uHardness', 8).f('uZeroCross', 0.58));
    pass(progs.strokes, strokes, p => p.tex('uTfm', 0, tfmA.tex).f('uTexel', ...small).f('uRes', rt.sw, rt.sh));
    pass(progs.paint, null, p => p.tex('uSrc', 0, kuw.tex).tex('uStrokes', 1, strokes.tex).f('uTexel', ...full).f('uSmallTexel', ...small).f('uRes', rt.w, rt.h)
      .f('uStroke', settings.stroke).f('uImpasto', settings.impasto).f('uCanvas', settings.canvas));
  }

  return { apply };
}
