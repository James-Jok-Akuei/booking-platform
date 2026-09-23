// @nestjs/swagger's PartialType, not @nestjs/mapped-types'. Both produce the
// same runtime validation, but only this one carries the parent's property
// metadata into the generated contract — with the other, this DTO appeared in
// docs/openapi.json as an object with NO properties, and a client generated
// from it could not send a single field (§60).
import { PartialType } from '@nestjs/swagger';
import { CreateServiceDto } from './create-service.dto';

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}
