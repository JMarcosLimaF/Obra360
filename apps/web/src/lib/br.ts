/** Formatos brasileiros usados nos cadastros: CNPJ e valor em reais. */

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Máscara progressiva: 12.345.678/0001-90 enquanto digita. */
export function maskCnpj(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** Dígitos verificadores do CNPJ (módulo 11). */
export function cnpjValido(raw: string): boolean {
  const d = onlyDigits(raw);
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((n, w, i) => n + w * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** Valor digitado como "1.234.567,89" → 1234567.89 (centavos pela direita). */
export function maskBrl(raw: string): string {
  const d = onlyDigits(raw).replace(/^0+(?=\d)/, "").slice(0, 15);
  if (!d) return "";
  const cents = d.padStart(3, "0");
  const int = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${int},${cents.slice(-2)}`;
}

export function parseBrl(masked: string): number | undefined {
  const d = onlyDigits(masked);
  return d ? Number(d) / 100 : undefined;
}

export const fmtBrl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
