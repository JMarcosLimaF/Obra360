import { describe, expect, it } from "vitest";
import { cnpjValido, formatCnpj } from "../src/lib/cnpj.ts";

describe("cnpjValido", () => {
  it("aceita CNPJ com dígitos verificadores corretos", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11444777000161")).toBe(true);
  });

  it("recusa dígito verificador errado, tamanho errado e sequência repetida", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
    // os CNPJs dos dados de demonstração são fictícios
    expect(cnpjValido("12345678000190")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
  });

  it("formata com pontuação", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});
