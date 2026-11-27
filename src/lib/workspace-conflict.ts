import { ToolRejection } from '../../electron/tool-rejection.mjs';

export type WorkspaceFileConflict = {path:string;kind:"changed"|"protected"|"deleted"};

/** An acknowledged rejection, never a permission to overwrite or replay. */
export class WorkspaceConflictError extends Error {
  readonly fileConflict:WorkspaceFileConflict;
  constructor(message:string,fileConflict:WorkspaceFileConflict) {
    super(message);this.name="WorkspaceConflictError";this.fileConflict=fileConflict;
  }
}

export function workspaceToolFailure(error:unknown,result?:unknown):Record<string,unknown> {
  if (error instanceof ToolRejection) return error.result();
  return {error:error instanceof Error?error.message:String(error),...(result!==undefined?{result}:{}),
    ...(error instanceof WorkspaceConflictError?{ok:false,fileConflict:error.fileConflict,definitelyNotExecuted:true}:{})};
}
