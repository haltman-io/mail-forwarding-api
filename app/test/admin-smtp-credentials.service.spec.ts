import { jest } from "@jest/globals";

import { AdminSmtpCredentialsService } from "../src/modules/admin/smtp-credentials/admin-smtp-credentials.service.js";
import type {
  AdminSmtpCredentialRow,
  AdminSmtpUserRow,
  SmtpInviteTokenRow,
} from "../src/modules/admin/smtp-credentials/admin-smtp-credentials.repository.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

interface AppSettings {
  publicUrl: string;
}

interface SmtpSettings {
  host: string;
  submissionHost: string;
  submissionPort: number;
  submissionSecure: boolean;
}

interface InviteCreatePayload {
  tokenHash: Buffer;
  createdBy: string;
  allowedSenderConstraint: string | null;
  expiresAt: Date;
}

type TestConfig = AppSettings | SmtpSettings;
type TestAliasRow = {
  id: number;
  address: string;
  goto: string;
  active: number;
  domain_id: number | null;
  created: Date | string | null;
  modified: Date | string | null;
};
type TestDomainRow = {
  id: number;
  name: string;
  active: number;
  active_mx: number;
  active_ui: number;
  visible: number;
};

describe("AdminSmtpCredentialsService", () => {
  const connection = {};
  const authContext = {
    session_id: 1,
    session_family_id: "family-1",
    user_id: 7,
    username: "root",
    email: "admin@example.com",
    is_admin: 1,
    email_verified_at: null,
    refresh_expires_at: null,
    password_changed_at: null,
    access_claims: null,
    access_expires_at: null,
  };

  function smtpUserRow(username = "my-service"): AdminSmtpUserRow {
    return {
      id: 5,
      username,
      password: "{ARGON2ID}$hash",
      active: 1,
      created_at: "2026-09-06 10:00:00",
    };
  }

  function inviteRow(input: Partial<SmtpInviteTokenRow> = {}): SmtpInviteTokenRow {
    return {
      id: 9,
      token_hash: Buffer.alloc(32),
      created_by: "admin@example.com",
      allowed_sender_constraint: null,
      is_used: 0,
      used_at: null,
      created_username: null,
      expires_at: "2026-09-06 12:00:00",
      created_at: "2026-09-06 10:00:00",
      ...input,
    };
  }

  function createService() {
    const configService = {
      getOrThrow: jest.fn((key: string): TestConfig => {
        if (key === "app") {
          return { publicUrl: "https://panel.example.com" };
        }
        if (key === "smtp") {
          return {
            host: "relay.internal",
            submissionHost: "smtp.example.com",
            submissionPort: 587,
            submissionSecure: false,
          };
        }
        throw new Error(`unexpected_config:${key}`);
      }),
    };
    const database = {
      withTransaction: jest.fn(
        <T>(callback: (txConnection: typeof connection) => Promise<T>): Promise<T> =>
          callback(connection),
      ),
    };
    const smtpCredentialsRepository = {
      listCredentials: jest.fn(
        (): Promise<AdminSmtpCredentialRow[]> => Promise.resolve([]),
      ),
      countCredentials: jest.fn((): Promise<number> => Promise.resolve(0)),
      getUserByUsername: jest.fn(
        (): Promise<AdminSmtpUserRow | null> => Promise.resolve(null),
      ),
      listActiveSendersForLogins: jest.fn(
        (): Promise<Map<string, string[]>> => Promise.resolve(new Map()),
      ),
      createUser: jest.fn(
        (): Promise<{ ok: boolean; insertId: number | null }> => Promise.resolve({
          ok: true,
          insertId: 5,
        }),
      ),
      updateUser: jest.fn((): Promise<void> => Promise.resolve()),
      deleteUser: jest.fn((): Promise<void> => Promise.resolve()),
      deleteAclByLogin: jest.fn((): Promise<void> => Promise.resolve()),
      replaceAllowedSenders: jest.fn((): Promise<void> => Promise.resolve()),
      createInvite: jest.fn(
        (payload: InviteCreatePayload): Promise<SmtpInviteTokenRow> =>
          Promise.resolve(inviteRow({
            token_hash: payload.tokenHash,
            created_by: payload.createdBy,
            allowed_sender_constraint: payload.allowedSenderConstraint,
            expires_at: payload.expiresAt,
          })),
      ),
      getPendingInviteByTokenHash: jest.fn(
        (): Promise<SmtpInviteTokenRow | null> => Promise.resolve(null),
      ),
      markInviteUsed: jest.fn((): Promise<boolean> => Promise.resolve(true)),
    };
    const passwordService = {
      assertPlainPassword: jest.fn((value: unknown): string => {
        if (typeof value !== "string" || value.length < 8) {
          throw new Error("invalid_password");
        }
        return value;
      }),
      hashPassword: jest.fn(
        (): Promise<string> =>
          Promise.resolve("$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$ZGlnZXN0"),
      ),
    };
    const adminAliasesRepository = {
      getByAddress: jest.fn((): Promise<TestAliasRow | null> =>
        Promise.resolve({
          id: 10,
          address: "contact@example.com",
          goto: "owner@example.net",
          active: 1,
          domain_id: 2,
          created: null,
          modified: null,
        }),
      ),
    };
    const adminDomainsRepository = {
      getByName: jest.fn((): Promise<TestDomainRow | null> =>
        Promise.resolve({
          id: 2,
          name: "example.com",
          active: 1,
          active_mx: 1,
          active_ui: 1,
          visible: 1,
        }),
      ),
      getEmailValidByName: jest.fn((): Promise<TestDomainRow | null> =>
        Promise.resolve({
          id: 2,
          name: "example.com",
          active: 1,
          active_mx: 1,
          active_ui: 1,
          visible: 1,
        }),
      ),
    };

    const service = new AdminSmtpCredentialsService(
      configService as never,
      database as never,
      smtpCredentialsRepository as never,
      passwordService as never,
      adminAliasesRepository as never,
      adminDomainsRepository as never,
    );

    return {
      service,
      configService,
      database,
      smtpCredentialsRepository,
      passwordService,
      adminAliasesRepository,
      adminDomainsRepository,
    };
  }

  it("creates a credential with Dovecot Argon2id hash and deduped sender ACLs", async () => {
    const {
      service,
      smtpCredentialsRepository,
      passwordService,
      adminAliasesRepository,
    } = createService();

    smtpCredentialsRepository.getUserByUsername
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(smtpUserRow());
    smtpCredentialsRepository.listActiveSendersForLogins.mockResolvedValue(
      new Map([["my-service", ["alerts@example.com", "contact@example.com"]]]),
    );

    const result = await service.createCredential({
      username: " My-Service ",
      allowed_senders: [
        "Contact@Example.com",
        "contact@example.com",
        "alerts@example.com",
      ],
      active: true,
    });

    expect(passwordService.hashPassword).toHaveBeenCalledWith(result.password);
    expect(smtpCredentialsRepository.createUser).toHaveBeenCalledWith(
      {
        username: "my-service",
        passwordHash: "{ARGON2ID}$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$ZGlnZXN0",
        active: true,
      },
      connection,
    );
    expect(smtpCredentialsRepository.replaceAllowedSenders).toHaveBeenCalledWith(
      "my-service",
      ["contact@example.com", "alerts@example.com"],
      connection,
    );
    expect(adminAliasesRepository.getByAddress).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      generated_password: true,
      item: {
        id: 5,
        username: "my-service",
        active: 1,
        allowed_senders: ["alerts@example.com", "contact@example.com"],
      },
    });
  });

  it("rejects direct SMTP ACL creation for a sender without an active hosted alias", async () => {
    const { service, smtpCredentialsRepository, adminAliasesRepository } = createService();
    smtpCredentialsRepository.getUserByUsername.mockResolvedValueOnce(null);
    adminAliasesRepository.getByAddress.mockResolvedValueOnce(null);

    try {
      await service.createCredential({
        username: "my-service",
        password: "CorrectHorse1",
        allowed_senders: ["contact@example.com"],
      });
      fail("expected createCredential to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(404);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "sender_alias_not_found",
        sender: "contact@example.com",
      });
    }

    expect(smtpCredentialsRepository.createUser).not.toHaveBeenCalled();
  });

  it("rejects an empty credential patch", async () => {
    const { service } = createService();

    await expect(service.updateCredential("my-service", {})).rejects.toMatchObject({
      response: { error: "empty_patch" },
      status: 400,
    });
  });

  it("replaces allowed senders with an empty ACL list on patch", async () => {
    const { service, smtpCredentialsRepository } = createService();
    smtpCredentialsRepository.getUserByUsername
      .mockResolvedValueOnce(smtpUserRow())
      .mockResolvedValueOnce(smtpUserRow());
    smtpCredentialsRepository.listActiveSendersForLogins.mockResolvedValue(new Map());

    const result = await service.updateCredential("my-service", {
      allowed_senders: [],
    });

    expect(smtpCredentialsRepository.replaceAllowedSenders).toHaveBeenCalledWith(
      "my-service",
      [],
      connection,
    );
    expect(result.item.allowed_senders).toEqual([]);
  });

  it("generates a setup URL with a hashed stored token", async () => {
    const { service, smtpCredentialsRepository } = createService();

    const result = await service.createInvite({ expires_in_hours: 2 }, authContext);

    const createInvitePayload = smtpCredentialsRepository.createInvite.mock.calls[0]?.[0];
    expect(createInvitePayload?.tokenHash).toBeInstanceOf(Buffer);
    expect(createInvitePayload).toMatchObject({
      createdBy: "admin@example.com",
      allowedSenderConstraint: null,
    });
    expect(result.setup_url).toMatch(
      /^https:\/\/panel\.example\.com\/api\/smtp-setup\/[A-Za-z0-9_-]+$/,
    );
  });

  it("rejects setup claim when a constrained token is used for another sender", async () => {
    const { service, smtpCredentialsRepository } = createService();
    smtpCredentialsRepository.getPendingInviteByTokenHash.mockResolvedValue(
      inviteRow({ allowed_sender_constraint: "contact@example.com" }),
    );

    try {
      await service.claimSetup("a".repeat(32), {
        alias: "alerts@example.com",
        username: "my-service",
        password: "CorrectHorse1",
      });
      fail("expected claimSetup to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(403);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "sender_not_allowed",
        allowed_sender_constraint: "contact@example.com",
      });
    }

    expect(smtpCredentialsRepository.createUser).not.toHaveBeenCalled();
    expect(smtpCredentialsRepository.markInviteUsed).not.toHaveBeenCalled();
  });

  it("claims a setup token atomically and returns SMTP submission params", async () => {
    const { service, smtpCredentialsRepository } = createService();
    smtpCredentialsRepository.getPendingInviteByTokenHash.mockResolvedValue(inviteRow());
    smtpCredentialsRepository.getUserByUsername.mockResolvedValueOnce(null);
    smtpCredentialsRepository.markInviteUsed.mockResolvedValue(true);

    const result = await service.claimSetup("a".repeat(32), {
      alias: "Contact@Example.com",
      username: " My-Service ",
      password: "CorrectHorse1",
    });

    expect(smtpCredentialsRepository.createUser).toHaveBeenCalledWith(
      {
        username: "my-service",
        passwordHash: "{ARGON2ID}$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$ZGlnZXN0",
        active: true,
      },
      connection,
    );
    expect(smtpCredentialsRepository.replaceAllowedSenders).toHaveBeenCalledWith(
      "my-service",
      ["contact@example.com"],
      connection,
    );
    expect(smtpCredentialsRepository.markInviteUsed).toHaveBeenCalledWith(
      9,
      "my-service",
      connection,
    );
    expect(result).toEqual({
      ok: true,
      claimed: true,
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "my-service",
        password: "CorrectHorse1",
        sender: "contact@example.com",
      },
    });
  });
});
