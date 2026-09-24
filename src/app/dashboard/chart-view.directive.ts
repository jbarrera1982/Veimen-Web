import { Directive, ElementRef, OnDestroy, OnInit, signal } from '@angular/core';

@Directive({
  selector: '[chartView]',
  standalone: true,
  exportAs: 'chartView',
})
export class ChartViewDirective implements OnInit, OnDestroy {
  readonly dims = signal<[number, number] | null>(null);

  private readonly el: HTMLElement;
  private observer?: ResizeObserver;

  constructor(elRef: ElementRef<HTMLElement>) {
    this.el = elRef.nativeElement;
  }

  ngOnInit(): void {
    const rect = this.el.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2) {
      this.dims.set([Math.floor(rect.width), Math.floor(rect.height)]);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const width = Math.floor(entry.contentRect.width);
        const height = Math.floor(entry.contentRect.height);
        if (width < 2 || height < 2) return;
        const current = this.dims();
        if (current && current[0] === width && current[1] === height) return;
        this.dims.set([width, height]);
      });
      this.observer.observe(this.el);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
