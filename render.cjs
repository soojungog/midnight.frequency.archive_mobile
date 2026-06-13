const fs = require("fs");
const path = require("path");
const Module = require("module");

const nodeModules = "C:\\Users\\sujeong\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
const pnpmModules = path.join(nodeModules, ".pnpm", "node_modules");
process.env.NODE_PATH = [nodeModules, pnpmModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

const { chromium } = require("playwright");

const width = 720;
const height = 1280;
const fps = 30;
const configPath = path.resolve(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const outputPath = path.resolve(__dirname, `${config.outputName}.mp4`);

function dataUrl(relativePath) {
  const filePath = path.resolve(__dirname, relativePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

(async () => {
  const browserCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

  await page.setContent("<!doctype html><body></body>", { waitUntil: "load" });

  const payload = {
    fps,
    config,
    bgUrl: dataUrl(config.background),
    albumUrls: config.tracks.map((track) => dataUrl(track.image))
  };

  const videoBase64 = await page.evaluate(async ({ fps, config, bgUrl, albumUrls }) => {
    function buildScenes(config) {
      const intro = config.timing?.intro ?? 2;
      const album = config.timing?.album ?? 10;
      const outro = config.timing?.outro ?? 2;
      let cursor = 0;
      const scenes = [{
        start: cursor,
        end: cursor + intro,
        type: "intro",
        kicker: config.issue,
        title: config.headline,
        subtitle: config.introSubtitle || config.brand
      }];
      cursor += intro;

      config.tracks.forEach((track, imageIndex) => {
        scenes.push({ ...track, imageIndex, start: cursor, end: cursor + album, type: "album" });
        cursor += album;
      });

      scenes.push({
        start: cursor,
        end: cursor + outro,
        type: "outro",
        kicker: config.outro.kicker,
        title: config.outro.title,
        subtitle: config.outro.subtitle
      });

      return { scenes, duration: cursor + outro };
    }

    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const { scenes, duration } = buildScenes(config);

    const loadImage = (url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load image: ${url.slice(0, 64)}`));
      image.src = url;
    });

    const bg = await loadImage(bgUrl);
    const albumImages = await Promise.all(albumUrls.map(loadImage));
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    function fadeFor(scene, time) {
      const local = time - scene.start;
      const remaining = scene.end - time;
      return clamp(Math.min(ease(local / 0.8), ease(remaining / 0.55)), 0, 1);
    }

    function drawCover(image) {
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }

    function drawWrappedText(text, x, y, maxWidth, lineHeight) {
      const words = String(text).split(" ");
      const lines = [];
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      lines.push(line);
      lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
      return y + lines.length * lineHeight;
    }

    function drawBackground() {
      drawCover(bg);
      let gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "rgba(4,10,16,0.02)");
      gradient.addColorStop(0.64, "rgba(3,8,13,0.54)");
      gradient.addColorStop(1, "rgba(1,5,9,0.88)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "rgba(1,4,8,0.34)");
      gradient.addColorStop(0.42, "rgba(1,4,8,0.03)");
      gradient.addColorStop(1, "rgba(1,4,8,0.25)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawFooter(time) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = "rgb(232,240,247)";
      ctx.font = "600 13px Segoe UI, Arial, sans-serif";
      ctx.fillText(config.brand, 48, 88);
      ctx.fillStyle = "rgba(232,240,247,0.18)";
      ctx.fillRect(586, 83, 86, 1);
      ctx.fillStyle = "rgba(244,248,252,0.76)";
      ctx.fillRect(586, 83, 86 * (time / duration), 1);
      ctx.restore();
    }

    function drawRecord(image, localTime, alpha) {
      const size = 520;
      const secondsPerRotation = config.record?.secondsPerRotation ?? 16;
      const angle = localTime * (Math.PI * 2 / secondsPerRotation);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(canvas.width / 2, canvas.height / 2 - 70);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    function drawSceneText(scene, alpha, yOffset) {
      const x = 48;
      const bottom = scene.type === "album" ? 1024 : 1180;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, yOffset);
      if (scene.type === "album") {
        ctx.fillStyle = "rgba(205,218,228,0.46)";
        ctx.font = "600 19px Segoe UI, Arial, sans-serif";
        ctx.fillText(scene.number, x, bottom - 190);
        ctx.fillStyle = "rgba(244,248,252,0.94)";
        ctx.font = "650 62px Segoe UI, Arial, sans-serif";
        const afterTitle = drawWrappedText(scene.title, x, bottom - 128, 600, 64);
        ctx.fillStyle = "rgba(222,232,240,0.68)";
        ctx.font = "430 25px Segoe UI, Arial, sans-serif";
        drawWrappedText(scene.artist, x, afterTitle + 26, 600, 34);
      } else {
        ctx.fillStyle = "rgba(205,218,228,0.46)";
        ctx.font = "600 14px Segoe UI, Arial, sans-serif";
        ctx.fillText(String(scene.kicker).toUpperCase(), x, bottom - 238);
        ctx.fillStyle = "rgba(244,248,252,0.94)";
        ctx.font = "650 58px Segoe UI, Arial, sans-serif";
        const afterTitle = drawWrappedText(scene.title, x, bottom - 184, 590, 62);
        ctx.fillStyle = "rgba(222,232,240,0.68)";
        ctx.font = "420 24px Segoe UI, Arial, sans-serif";
        drawWrappedText(scene.subtitle, x, afterTitle + 24, 560, 34);
      }
      ctx.restore();
    }

    function drawFrame(time) {
      const scene = scenes.find((item) => time >= item.start && time < item.end) || scenes[scenes.length - 1];
      const alpha = fadeFor(scene, time);
      const yOffset = (1 - alpha) * 18;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground();
      drawFooter(time);
      if (scene.type === "album") {
        drawRecord(albumImages[scene.imageIndex], time - scene.start, alpha);
      }
      drawSceneText(scene, alpha, yOffset);
    }

    const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E")
      ? "video/mp4;codecs=avc1.42E01E"
      : "video/webm;codecs=vp9";
    const blobType = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
    const stream = canvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3500000 });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };

    await new Promise((resolve, reject) => {
      recorder.onerror = () => reject(recorder.error || new Error("Recorder failed"));
      recorder.onstop = resolve;
      recorder.start();

      requestAnimationFrame(async () => {
        try {
          const totalFrames = Math.ceil(duration * fps);
          for (let frame = 0; frame < totalFrames; frame += 1) {
            drawFrame(Math.min(frame / fps, duration - 0.001));
            if (videoTrack?.requestFrame) videoTrack.requestFrame();
            if (frame % 10 === 0) {
              await new Promise((frameResolve) => requestAnimationFrame(frameResolve));
            }
          }
          if (videoTrack?.requestFrame) videoTrack.requestFrame();
          recorder.requestData();
          recorder.stop();
        } catch (error) {
          reject(error);
        }
      });
    });

    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: blobType });
    if (!blob.size) throw new Error("Rendered video is empty.");
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return {
      base64: btoa(binary),
      extension: blobType === "video/mp4" ? "mp4" : "webm"
    };
  }, payload);

  const finalOutputPath = outputPath.replace(/\.mp4$/, `.${videoBase64.extension}`);
  fs.writeFileSync(finalOutputPath, Buffer.from(videoBase64.base64, "base64"));
  await browser.close();
  console.log(finalOutputPath);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
