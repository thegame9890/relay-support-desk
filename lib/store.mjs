import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path) { this.path = path; this.data = { conversations: [], feedback: [], tickets: [], preferences: [] }; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try { this.data = JSON.parse(await readFile(this.path, 'utf8')); this.data.preferences ||= []; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async save() {
    this.queue = this.queue.then(async () => { const temp = `${this.path}.tmp`; await writeFile(temp, JSON.stringify(this.data, null, 2)); await rename(temp, this.path); });
    return this.queue;
  }
  conversation(id) { return this.data.conversations.find(item => item.id === id); }
  async createConversation() { const item = { id: randomUUID(), createdAt: new Date().toISOString(), messages: [] }; this.data.conversations.unshift(item); await this.save(); return item; }
  async addFeedback(item) { const entry = { id: randomUUID(), createdAt: new Date().toISOString(), ...item }; this.data.feedback.unshift(entry); await this.save(); return entry; }
  async addTicket(item) { const entry = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'open', ...item }; this.data.tickets.unshift(entry); await this.save(); return entry; }
  async addPreference(item) { const entry = { id: randomUUID(), createdAt: new Date().toISOString(), ...item }; this.data.preferences.unshift(entry); await this.save(); return entry; }
}
