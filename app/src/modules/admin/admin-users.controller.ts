import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import { clearAuthCookies } from "../../shared/utils/auth-cookies.js";
import type { AuthSettings } from "../auth/auth.types.js";
import {
  AdminCreateUserDto,
  AdminUpdateOwnPasswordDto,
  AdminUpdateUserDto,
  AdminUsersListQueryDto,
} from "./admin.dto.js";
import { AdminUsersService } from "./admin-users.service.js";

interface AppSettings {
  envName: string;
}

@Controller("admin/users")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminUsersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get()
  async listUsers(
    @Query() query: AdminUsersListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminUsersService.listUsers(query));
  }

  @Get(":id")
  async getUser(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminUsersService.getUserById(id));
  }

  @Post()
  async createUser(
    @Body() dto: AdminCreateUserDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(
      await this.adminUsersService.createUser(dto, request.admin_auth!, {
        ip: String(request.ip || ""),
        userAgent: String(request.headers["user-agent"] || ""),
      }),
    );
  }

  @Patch("me/password")
  async updateOwnPassword(
    @Body() dto: AdminUpdateOwnPasswordDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.adminUsersService.updateOwnPassword(dto, request.admin_auth!, {
      ip: String(request.ip || ""),
      userAgent: String(request.headers["user-agent"] || ""),
    });

    if (result.shouldClearAuthCookies) {
      this.clearCookies(response);
    }

    response.status(200).json({
      ok: result.ok,
      updated: result.updated,
      reauth_required: result.reauth_required,
      sessions_revoked: result.sessions_revoked,
    });
  }

  @Patch(":id")
  async updateUser(
    @Param("id") id: string,
    @Body() dto: AdminUpdateUserDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.adminUsersService.updateUser(id, dto, request.admin_auth!, {
      ip: String(request.ip || ""),
      userAgent: String(request.headers["user-agent"] || ""),
    });

    if (result.shouldClearAuthCookies) {
      this.clearCookies(response);
    }

    response.status(200).json({
      ok: result.ok,
      updated: result.updated,
      sessions_revoked: result.sessions_revoked,
      item: result.item,
    });
  }

  @Delete(":id")
  async deleteUser(
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.adminUsersService.deleteUser(id, request.admin_auth!, {
      ip: String(request.ip || ""),
      userAgent: String(request.headers["user-agent"] || ""),
    });

    if (result.shouldClearAuthCookies) {
      this.clearCookies(response);
    }

    response.status(200).json({
      ok: result.ok,
      deleted: result.deleted,
      sessions_revoked: result.sessions_revoked,
      item: result.item,
    });
  }

  private clearCookies(response: Response): void {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const authSettings = this.configService.getOrThrow<AuthSettings>("auth");
    clearAuthCookies(response, appSettings.envName, authSettings.cookieSameSite);
  }
}
