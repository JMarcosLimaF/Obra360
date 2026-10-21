import type { NcRole } from "../domain/types.ts";

/** Os papéis do schema.sql (enum member_role). */
export type MemberRole = "owner" | "gestor" | "engenheiro" | "campo" | "empreiteiro" | "visitante";

/**
 * De que lado da mesa cada membro senta no trâmite da NC.
 * O papel sai da sessão, nunca do cliente: o antigo seletor "atuando como"
 * deixou de existir — quem é construtora entra com usuário da construtora.
 */
export function ncRoleOf(role: MemberRole): NcRole | null {
  switch (role) {
    case "engenheiro":
    case "campo":
      return "fiscalizacao";
    case "empreiteiro":
      return "construtora";
    case "gestor":
    case "owner":
      return "gestor";
    default:
      return null;
  }
}

/** Quem escreve o acervo da obra (RDO, plantas, análises): o lado da fiscalização. */
export const WRITERS: MemberRole[] = ["owner", "gestor", "engenheiro", "campo"];

/** Quem cadastra obra, contrato e contratada (policies projects_write, contracts_write, contractors_write). */
export const PROJECT_ADMINS: MemberRole[] = ["owner", "gestor"];
