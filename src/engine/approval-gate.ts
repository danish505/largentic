import * as readline from 'readline';
import type { ApprovalDecision, FinalReviewDecision } from '../types.js';

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

  async requestFinalReviewApproval(): Promise<FinalReviewDecision> {
    return this.requestDecision(
      '  [a]pprove / [r]eject / [c]ancel: ',
      ['approved', 'rejected', 'cancelled']
    ) as Promise<FinalReviewDecision>;
  }

  async requestFinalReviewRejection(): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question('  Provide actionable final-review feedback: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  private async requestDecision(
    prompt: string,
    allowed: FinalReviewDecision[]
  ): Promise<FinalReviewDecision> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      const ask = (): void => {
        rl.question(prompt, (answer) => {
          const normalized = answer.trim().toLowerCase();
          const decision = normalized === 'a' || normalized === 'approve' ? 'approved'
            : normalized === 'r' || normalized === 'reject' ? 'rejected'
              : normalized === 'c' || normalized === 'cancel' ? 'cancelled' : null;
          if (decision && allowed.includes(decision)) {
            rl.close();
            resolve(decision);
            return;
          }
          process.stdout.write('  Invalid choice. Please enter a, r, or c.\n');
          ask();
        });
      };
      ask();
    });
  }
}
