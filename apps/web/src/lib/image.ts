/**
 * Redução das capturas do tour antes de guardar.
 *
 * O screenshot do SDK vem em 1280×720; guardado inteiro em localStorage, meia
 * dúzia de análises já estoura a cota do navegador. Guardamos uma miniatura
 * larga o bastante para servir de anexo fotográfico do RDO impresso.
 */
export async function downscaleDataUrl(
  dataUrl: string,
  maxWidth = 720,
  quality = 0.62,
): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    if (img.width <= maxWidth) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = maxWidth;
    canvas.height = Math.round((img.height * maxWidth) / img.width);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("imagem inválida"));
    img.src = src;
  });
}

/**
 * Detecta quadro em branco/preto — o showcase devolve um frame vazio quando a
 * foto é disparada antes de a cena terminar de renderizar. Uma foto assim não
 * pode entrar no anexo probatório do RDO.
 */
export async function isBlankFrame(dataUrl: string, threshold = 12): Promise<boolean> {
  try {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 24;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let p = 0; p < data.length; p += 4) sum += data[p] + data[p + 1] + data[p + 2];
    return sum / (data.length / 4) / 3 < threshold;
  } catch {
    return false;
  }
}

/** Converte uma URL pública em data URL — a API precisa dos bytes, não do link. */
export async function srcToDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("falha ao ler a imagem"));
    fr.readAsDataURL(blob);
  });
}

/** Lê um arquivo escolhido pelo usuário como data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("falha ao ler o arquivo"));
    fr.readAsDataURL(file);
  });
}

/**
 * Desenha a mira sobre a imagem, na posição relativa em que o usuário apontou.
 *
 * Sem isso, quem recebe a notificação vê uma parede inteira e não sabe onde
 * está o defeito — que é justamente o problema que a ancoragem 3D existe para
 * resolver. O marcador é queimado no pixel: a imagem é o documento, e o
 * documento tem de se explicar sozinho fora do sistema.
 */
export function markPoint(dataUrl: string, xRatio: number, yRatio: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0);

      const x = Math.round(xRatio * canvas.width);
      const y = Math.round(yRatio * canvas.height);
      const r = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.045));
      const lw = Math.max(2, Math.round(r * 0.13));

      // halo escuro por baixo, para a mira sobreviver em parede clara
      ctx.lineWidth = lw + 3;
      ctx.strokeStyle = "rgba(8,20,32,0.55)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = lw;
      ctx.strokeStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#009BFF";
      ctx.lineWidth = lw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x + dx * r * 0.55, y + dy * r * 0.55);
        ctx.lineTo(x + dx * r * 1.65, y + dy * r * 1.65);
        ctx.stroke();
      }
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
