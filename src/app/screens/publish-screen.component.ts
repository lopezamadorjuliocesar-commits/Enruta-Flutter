import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';

@Component({
  selector: 'app-publish-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  templateUrl: './publish-screen.component.html',
})
export class PublishScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
}
