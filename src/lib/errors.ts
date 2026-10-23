/** Erros de domínio com mensagens seguras para exibição ao usuário. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "app_error",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message, "validation", 422);
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("Sessão expirada. Entre novamente.", "unauthenticated", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para esta operação.", public readonly permission?: string) {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Registro não encontrado.") {
    super(message, "not_found", 404);
  }
}

/** Funcionalidade não contratada ou limite do plano atingido (diferente de falta de autorização). */
export class PlanRestrictionError extends AppError {
  constructor(message: string, public readonly feature?: string) {
    super(message, "plan_restriction", 402);
  }
}

/** Assinatura suspensa/encerrada ou acesso de suporte: somente leitura. */
export class ReadOnlyError extends AppError {
  constructor(message = "Sua empresa está em modo somente leitura. Regularize a assinatura para voltar a registrar operações.") {
    super(message, "read_only", 423);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict", 409);
  }
}

/** Converte erros do PostgreSQL disparados pelas regras do banco em mensagens de domínio. */
export function fromDbError(err: unknown): AppError | null {
  const e = err as { code?: string; message?: string; constraint?: string };
  if (!e || typeof e !== "object" || !e.code) return null;
  if (e.code === "P0001") return new AppError(e.message ?? "Operação não permitida.", "rule");
  if (e.code === "42501") return new ForbiddenError(e.message?.startsWith("new row violates") ? undefined : e.message);
  if (e.code === "23505") return new ConflictError("Já existe um registro com esses dados.");
  if (e.code === "23503") return new ValidationError("Referência inválida a outro registro.");
  if (e.code === "23514") return new ValidationError("Os dados informados violam uma regra de consistência.");
  return null;
}
