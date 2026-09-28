import { TestBed } from '@angular/core/testing';
import { BusinessModelComponent } from './business-model.component';

describe('BusinessModelComponent', () => {
  let fixture: any;
  let component: BusinessModelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BusinessModelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BusinessModelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should embed the business model PDF in an iframe', () => {
    const frame: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe.pdf-frame');
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toContain('TUCOOP_Gestion_de_Valor.pdf');
    expect(frame.getAttribute('title')).toBe('Modelo de negocios TUCOOP');
  });

  it('should offer a fallback link that opens the PDF in a new tab', () => {
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.btn-secondary');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('TUCOOP_Gestion_de_Valor.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
