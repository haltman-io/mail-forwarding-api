import { jest } from "@jest/globals";

import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";
import { AdminUsersService } from "../src/modules/admin/users/admin-users.service.js";

describe("AdminUsersService", () => {
  function createService() {
    const adminUsersRepository: any = {
      withTransaction: jest.fn(),
      getUserById: jest.fn(),
      getUserByEmail: jest.fn(),
      getUserByUsername: jest.fn(),
      createUser: jest.fn(),
      listUsers: jest.fn(),
      countUsers: jest.fn(),
      updateUserById: jest.fn(),
      revokeSessionsByUserId: jest.fn(),
      listActiveAdminIdsForUpdate: jest.fn(),
      deleteUserById: jest.fn(),
    };
    const passwordService: any = {
      assertPlainPassword: jest.fn(),
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
    };
    const adminNotificationService: any = {
      notifyAffectedAdmins: jest.fn(),
    };

    const service = new AdminUsersService(
      adminUsersRepository as never,
      passwordService as never,
      adminNotificationService as never,
    );

    return {
      service,
      adminUsersRepository,
      passwordService,
      adminNotificationService,
    };
  }

  it("rejects password changes for the authenticated actor via the generic patch route", async () => {
    const { service, adminUsersRepository } = createService();
    const currentUser = {
      id: 7,
      username: "admin",
      email: "admin@example.com",
      password_hash: "hash",
      email_verified_at: null,
      is_active: 1,
      is_admin: 1,
      password_changed_at: null,
      created_at: null,
      updated_at: null,
      last_login_at: null,
    };

    adminUsersRepository.withTransaction.mockImplementation(async (callback: any) => callback({}));
    adminUsersRepository.getUserById.mockResolvedValue(currentUser);

    try {
      await service.updateUser(
        7,
        { password: "NewPassword123!" },
        {
          session_id: 1,
          session_family_id: "family-123",
          user_id: 7,
          username: "admin",
          email: "admin@example.com",
          is_admin: 1,
          email_verified_at: null,
          refresh_expires_at: null,
          password_changed_at: null,
          access_claims: null,
          access_expires_at: null,
        },
        { ip: "203.0.113.7", userAgent: "jest" },
      );
      fail("expected updateUser to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "invalid_params",
        field: "password",
        reason: "use_self_password_route",
      });
    }
  });

  it("rejects changing the own password to the same value", async () => {
    const { service } = createService();

    try {
      await service.updateOwnPassword(
        {
          current_password: "SamePassword123!",
          new_password: "SamePassword123!",
        },
        {
          session_id: 1,
          session_family_id: "family-123",
          user_id: 7,
          username: "admin",
          email: "admin@example.com",
          is_admin: 1,
          email_verified_at: null,
          refresh_expires_at: null,
          password_changed_at: null,
          access_claims: null,
          access_expires_at: null,
        },
        { ip: "203.0.113.7", userAgent: "jest" },
      );
      fail("expected updateOwnPassword to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "invalid_params",
        field: "new_password",
        reason: "same_as_current",
      });
    }
  });

  it("physically deletes the user and returns the pre-delete snapshot", async () => {
    const { service, adminUsersRepository } = createService();
    const currentUser = {
      id: 7,
      username: "admin",
      email: "admin@example.com",
      password_hash: "hash",
      email_verified_at: null,
      is_active: 1,
      is_admin: 1,
      password_changed_at: null,
      created_at: null,
      updated_at: null,
      last_login_at: null,
    };

    adminUsersRepository.withTransaction.mockImplementation(async (callback: any) => callback({}));
    adminUsersRepository.getUserById.mockResolvedValue(currentUser);
    adminUsersRepository.listActiveAdminIdsForUpdate.mockResolvedValue([7, 8]);
    adminUsersRepository.revokeSessionsByUserId.mockResolvedValue(3);
    adminUsersRepository.deleteUserById.mockResolvedValue(true);

    const result = await service.deleteUser(
      7,
      {
        session_id: 1,
        session_family_id: "family-123",
        user_id: 99,
        username: "root",
        email: "root@example.com",
        is_admin: 1,
        email_verified_at: null,
        refresh_expires_at: null,
        password_changed_at: null,
        access_claims: null,
        access_expires_at: null,
      },
      { ip: "203.0.113.7", userAgent: "jest" },
    );

    expect(adminUsersRepository.revokeSessionsByUserId).toHaveBeenCalledWith(7, {}, expect.anything());
    expect(adminUsersRepository.deleteUserById).toHaveBeenCalledWith(7, expect.anything());
    expect(result).toMatchObject({
      ok: true,
      deleted: true,
      sessions_revoked: 3,
      item: {
        id: 7,
        email: "admin@example.com",
      },
    });
  });
});
