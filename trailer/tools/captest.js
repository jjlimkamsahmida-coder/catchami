(async () => {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, preferCurrentTab: true });
  const rec = new MediaRecorder(s, { mimeType: "video/webm;codecs=h264", videoBitsPerSecond: 24e6 });
  const parts = []; rec.ondataavailable = (e) => parts.push(e.data); rec.start();
  const pts = [[1500, 976], [1296, 976]]; let k = 0;
  const iv = setInterval(() => window.__ws.send(JSON.stringify({ t: "goto", x: pts[k % 2][0], y: pts[k++ % 2][1] })), 2500);
  window.__ws.send(JSON.stringify({ t: "goto", x: 1500, y: 976 }));
  await new Promise((r) => setTimeout(r, 5000)); clearInterval(iv);
  await new Promise((r) => { rec.onstop = r; rec.stop(); }); s.getTracks().forEach((t) => t.stop());
  const buf = new Uint8Array(await new Blob(parts).arrayBuffer()); let bin = "";
  for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
  window.__capB64 = btoa(bin); return buf.length;
})()
