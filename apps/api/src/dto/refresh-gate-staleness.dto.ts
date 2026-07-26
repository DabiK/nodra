import { IsString, ValidateIf } from "class-validator";
export class RefreshGateStalenessDto { @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
