import * as readline from 'readline';
import type { ApprovalDecision } from '../types.js';

export class ApprovalGate {
  /** If `prompt` is non-empty it is printed before asking. Pass empty string when
   *  the caller (e.g. ProgressReporter) has already printed the plan. */
  async requestApproval(prompt: string): Promise<ApprovalDecision> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const baseQuestion = prompt
      ? `\n${prompt}\n  [a]pprove / [r]eject / [u]pdate / [e]xport / [c]ancel: `
      : '  [a]pprove / [r]eject / [u]pdate / [e]xport / [c]ancel: ';

    return new Promise((resolve) => {
      const ask = (question: string): void => {
        rl.question(question, (answer) => {
          const a = answer.trim().toLowerCase();
          if (a === 'a' || a === 'approve') {
            rl.close();
            resolve('approved');
          } else if (a === 'r' || a === 'reject') {
            rl.close();
            resolve('rejected');
          } else if (a === 'u' || a === 'update') {
            rl.close();
            resolve('update');
          } else if (a === 'e' || a === 'export') {
            rl.close();
            resolve('exported');
          } else if (a === 'c' || a === 'cancel') {
            rl.close();
            resolve('cancelled');
          } else {
            process.stdout.write('  Invalid choice. Please enter a, r, u, e, or c.\n');
            ask('  [a]pprove / [r]eject / [u]pdate / [e]xport / [c]ancel: ');
          }
        });
      };

      ask(baseQuestion);
    });
  }

  async requestPlanUpdate(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('  Provide additional details / changes for the plan: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async requestFinalApproval(): Promise<'approved' | 'rejected' | 'cancelled'> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      const ask = (): void => rl.question('  [a]pprove / [r]eject / [c]ancel: ', (answer) => {
        const value = answer.trim().toLowerCase();
        if (value === 'a' || value === 'approve') { rl.close(); resolve('approved'); }
        else if (value === 'r' || value === 'reject') { rl.close(); resolve('rejected'); }
        else if (value === 'c' || value === 'cancel') { rl.close(); resolve('cancelled'); }
        else { process.stdout.write('  Invalid choice. Please enter a, r, or c.\n'); ask(); }
      });
      ask();
    });
  }

  async requestRejectionNotes(): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      const ask = (): void => rl.question('  Explain the changes required: ', (answer) => {
        const notes = answer.trim();
        if (notes) { rl.close(); resolve(notes); }
        else { process.stdout.write('  Rejection notes are required.\n'); ask(); }
      });
      ask();
    });
  }
}
