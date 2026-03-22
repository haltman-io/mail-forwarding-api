import { Injectable } from "@nestjs/common";
import net from "node:net";

import { type BanRow, BansRepository } from "./bans.repository.js";

@Injectable()
export class BanPolicyService {
  constructor(private readonly bansRepository: BansRepository) {}

  async findActiveIpBan(ip: string): Promise<BanRow | null> {
    const candidates = this.ipCandidates(ip);
    if (candidates.length === 0) {
      return null;
    }

    return this.bansRepository.getActiveBanByValues("ip", candidates);
  }

  async findActiveDomainBan(domain: string): Promise<BanRow | null> {
    const suffixes = this.domainSuffixes(domain);
    if (suffixes.length === 0) {
      return null;
    }

    return this.bansRepository.getActiveBanByValues("domain", suffixes);
  }

  async findActiveNameBan(name: string): Promise<BanRow | null> {
    const normalized = String(name ?? "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return this.bansRepository.getActiveBanByValues("name", [normalized]);
  }

  async findActiveEmailOrDomainBan(email: string): Promise<BanRow | null> {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const emailBan = await this.bansRepository.getActiveBanByValues("email", [normalized]);
    if (emailBan) {
      return emailBan;
    }

    const atIndex = normalized.indexOf("@");
    if (atIndex <= 0) {
      return null;
    }

    const domain = normalized.slice(atIndex + 1);
    return this.findActiveDomainBan(domain);
  }

  private domainSuffixes(domain: string): string[] {
    const normalized = String(domain ?? "").trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const parts = normalized.split(".").filter(Boolean);
    if (parts.length < 2) {
      return [];
    }

    const out: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < parts.length - 1; index += 1) {
      const value = parts.slice(index).join(".");
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }

    return out;
  }

  private ipCandidates(ip: string): string[] {
    const normalized = String(ip ?? "").trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const out = new Set<string>();
    if (net.isIP(normalized) === 4) {
      out.add(normalized);
      out.add(`::ffff:${normalized}`);
      return Array.from(out);
    }

    if (net.isIP(normalized) === 6) {
      out.add(normalized);
      const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
      if (mappedIpv4 && net.isIP(mappedIpv4) === 4) {
        out.add(mappedIpv4);
      }
      return Array.from(out);
    }

    return [];
  }
}
