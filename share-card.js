async function waitFonts() {
  if (!document.fonts?.ready) return;
  await document.fonts.ready;
  await Promise.allSettled([
    document.fonts.load("700 32px \"Cinzel Decorative\""),
    document.fonts.load("500 16px Cinzel"),
    document.fonts.load("italic 500 22px \"Cormorant Garamond\""),
    document.fonts.load("500 16px \"Cormorant Garamond\""),
  ]);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function mapRect(el, origin, dpr) {
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - origin.left) * dpr,
    y: (r.top - origin.top) * dpr,
    w: r.width * dpr,
    h: r.height * dpr,
  };
}

function paintedText(el) {
  const raw = el.textContent || "";
  return getComputedStyle(el).textTransform === "uppercase" ? raw.toUpperCase() : raw;
}

function setType(ctx, el, dpr) {
  const cs = getComputedStyle(el);
  const size = parseFloat(cs.fontSize) * dpr;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  ctx.fillStyle = cs.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const spacing = cs.letterSpacing;
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = spacing && spacing !== "normal" ? `${parseFloat(spacing) * dpr}px` : "0px";
  }
  const lineHeight =
    cs.lineHeight === "normal" ? size * 1.35 : parseFloat(cs.lineHeight) * dpr;
  return { size, lineHeight };
}

function drawVignette(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h * 0.22);
  g.addColorStop(0, "rgba(11, 9, 7, 0.42)");
  g.addColorStop(1, "rgba(11, 9, 7, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, h * 0.58, 0, h);
  g.addColorStop(0, "rgba(11, 9, 7, 0)");
  g.addColorStop(0.45, "rgba(11, 9, 7, 0.18)");
  g.addColorStop(1, "rgba(11, 9, 7, 0.78)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawMast(ctx, origin, dpr) {
  const mast = document.querySelector("#mast");
  const mark = document.querySelector(".mast-mark");
  const sub = document.querySelector(".mast-sub");
  if (!mast || !mark || !sub) return;
  const box = mapRect(mast, origin, dpr);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 18 * dpr;
  const markType = setType(ctx, mark, dpr);
  ctx.textAlign = "left";
  ctx.fillText(paintedText(mark), box.x, box.y);
  setType(ctx, sub, dpr);
  ctx.textAlign = "left";
  ctx.shadowBlur = 12 * dpr;
  ctx.fillText(paintedText(sub), box.x, box.y + markType.lineHeight + 2 * dpr);
  ctx.restore();
}

function drawHort(ctx, origin, dpr, canvasH) {
  const hort = document.querySelector("#hort");
  if (!hort || hort.hidden) return;
  const box = mapRect(hort, origin, dpr);
  box.y = canvasH - box.h - 28 * dpr;
  const cs = getComputedStyle(hort);
  const padX = parseFloat(cs.paddingLeft) * dpr;
  const padTop = parseFloat(cs.paddingTop) * dpr;
  const innerW = box.w - padX * 2;
  const cx = box.x + box.w / 2;

  ctx.save();
  ctx.fillStyle = "rgba(12, 10, 8, 0.88)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = "rgba(227, 154, 58, 0.35)";
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(box.x + ctx.lineWidth / 2, box.y + ctx.lineWidth / 2, box.w - ctx.lineWidth, box.h - ctx.lineWidth);
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  let y = box.y + padTop;
  const roll = hort.querySelector(".hort-roll");
  const line = hort.querySelector(".hort-line");
  const context = hort.querySelector(".hort-context");
  const cite = hort.querySelector("cite");

  const rollType = setType(ctx, roll, dpr);
  ctx.textAlign = "center";
  ctx.fillText(paintedText(roll), cx, y);
  y += rollType.lineHeight + 6 * dpr;

  const lineType = setType(ctx, line, dpr);
  ctx.textAlign = "center";
  for (const row of wrapText(ctx, paintedText(line), innerW)) {
    ctx.fillText(row, cx, y);
    y += lineType.lineHeight;
  }
  y += 6 * dpr;

  const ctxType = setType(ctx, context, dpr);
  ctx.textAlign = "center";
  for (const row of wrapText(ctx, paintedText(context), innerW)) {
    ctx.fillText(row, cx, y);
    y += ctxType.lineHeight;
  }
  y += 6 * dpr;

  setType(ctx, cite, dpr);
  ctx.textAlign = "center";
  ctx.fillText(paintedText(cite), cx, y);
  ctx.restore();
}

export async function composeShareStill(sceneBlob) {
  await waitFonts();
  const scene = await createImageBitmap(sceneBlob);
  const gl = document.querySelector("#die-stage");
  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(scene, 0, 0);
  const dpr = scene.width / Math.max(1, gl.clientWidth);
  const origin = gl.getBoundingClientRect();
  drawVignette(ctx, canvas.width, canvas.height);
  drawMast(ctx, origin, dpr);
  drawHort(ctx, origin, dpr, canvas.height);
  scene.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("share still failed"))), "image/png");
  });
}
