import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PromptsService } from '../services/prompts.service';

@Component({
  selector: 'app-prompt-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './prompt-form.html',
  styleUrl: './prompt-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptFormComponent implements OnInit {
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly isEdit = signal(false);

  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    promptId: [0],
    secuence: [1, Validators.min(0)],
    code: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    agent: ['', Validators.required],
    agentGroup: [''],
    type: ['', Validators.required],
    llmModel: ['', Validators.required],
    version: ['', Validators.required],
    systemPrompt: ['', Validators.required],
    userPrompt: [''],
    temperature: [0, [Validators.min(0), Validators.max(2)]],
    maxTokens: [0, Validators.min(1)],
    active: [true],
    observations: [''],
    createdBy: [''],
    createdAt: [''],
    updatedBy: [''],
    updatedAt: [''],
    schemaOutput: [''],
  });

  constructor(
    private promptsService: PromptsService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'nuevo') {
      this.isEdit.set(true);
      this.loadPrompt(Number(id));
    }
  }

  private loadPrompt(promptId: number): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.promptsService.getPrompt(promptId).subscribe({
      next: (prompt) => this.form.patchValue(prompt),
      error: () => {
        this.error.set('No se pudo cargar el prompt. Verifica la conexión con el webhook.');
        this.isLoading.set(false);
      },
      complete: () => {
        this.isLoading.set(false);
      },
    });
  }
}
