/** What request failures carry: axios puts the server's JSON body on response.data. */
export interface RequestFailure {
  message?: string;
  response?: {
    status?: number;
    data?: { error?: string; message?: string; code?: string };
  };
}

/**
 * Reads a caught value as a request failure without assuming its type, so
 * `catch` blocks need no `any`. Non-objects (a thrown string or null) carry no
 * details instead of throwing while the error is being reported.
 */
export function requestFailure(error: unknown): RequestFailure {
  return typeof error === 'object' && error !== null ? (error as RequestFailure) : {};
}
