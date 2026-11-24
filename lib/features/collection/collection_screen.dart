import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/payment_rules.dart';
import '../route/route_widgets.dart';

/// M-11 · Registro de cobro en ruta. Registra lo recibido (no procesa pagos
/// bancarios), aplica a documentos por ID y actualiza saldos en SQLite.
class CollectionScreen extends ConsumerStatefulWidget {
  const CollectionScreen({super.key, this.customerId, this.deliveryId});
  final String? customerId, deliveryId;
  @override
  ConsumerState<CollectionScreen> createState() => _CollectionState();
}

class _CollectionState extends ConsumerState<CollectionScreen> {
  final _sel = <String>{};
  bool _preselected = false;
  PaymentMethod _method = PaymentMethod.cash;
  final _amount = TextEditingController();
  final _ref = TextEditingController();
  final _key = newId();
  String? _amountError;

  @override
  void dispose() {
    _amount.dispose();
    _ref.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.customerId == null) {
      return const MissingData(
        title: 'Cobro',
        message: 'Falta indicar el cliente.',
      );
    }
    final customer = ref.watch(customerProvider(widget.customerId!)).value;
    final docsV = ref.watch(receivablesProvider(widget.customerId!));
    final wd = ref.watch(openWorkdayProvider).value;
    final inRoute = wd?.status == WorkdayStatus.inRoute;
    return AsyncBody(
      value: docsV,
      builder: (all) {
        final now = DateTime.now();
        final docs = all.where((d) => d.balanceCents > 0).toList();
        if (!_preselected) {
          _preselected = true;
          if (widget.deliveryId != null) {
            _sel.addAll(
              docs
                  .where((d) => d.deliveryId == widget.deliveryId)
                  .map((d) => d.id),
            );
          }
        }
        _sel.removeWhere((id) => !docs.any((d) => d.id == id));
        final selected = docs.where((d) => _sel.contains(d.id)).toList();
        final selectedTotal = selected.fold<int>(
          0,
          (a, d) => a + d.balanceCents,
        );
        final entered = parseCents(_amount.text) ?? 0;
        PaymentPlan? plan;
        String? planError;
        if (selectedTotal > 0 && entered > 0) {
          try {
            plan = planPayment(
              method: _method,
              selectedTotalCents: selectedTotal,
              enteredCents: entered,
              reference: _method == PaymentMethod.cash ? '' : _ref.text,
            );
          } on DomainException catch (e) {
            planError = e.message;
          }
        }
        final alloc = plan == null
            ? null
            : allocate(plan.appliedCents, selected);
        final balance = all.fold<int>(0, (a, d) => a + d.balanceCents);
        return EnScaffold(
          title: 'Registrar cobro',
          subtitle: customer?.name,
          back: true,
          children: [
            KpiRow([
              KpiCard(
                'Saldo del cliente',
                money(balance),
                valueColor: balance > 0 ? AppColors.error : AppColors.success,
                icon: Icons.account_balance_wallet,
              ),
              KpiCard(
                'Seleccionado',
                money(selectedTotal),
                icon: Icons.checklist,
              ),
            ]),
            if (!inRoute)
              const InfoBanner(
                'Los cobros se registran durante una jornada en ruta.',
                tone: Tone.warning,
              ),
            SectionTitle(
              'Documentos con saldo (${docs.length})',
              trailing: docs.isEmpty
                  ? null
                  : TextButton(
                      onPressed: () => setState(
                        () => _sel.length == docs.length
                            ? _sel.clear()
                            : _sel.addAll(docs.map((d) => d.id)),
                      ),
                      child: Text(
                        _sel.length == docs.length ? 'Ninguno' : 'Todos',
                      ),
                    ),
            ),
            if (docs.isEmpty)
              const EmptyState(
                'El cliente no tiene documentos pendientes.',
                icon: Icons.task_alt,
              )
            else
              ListGroup(
                children: [
                  for (final d in docs)
                    CheckboxListTile(
                      value: _sel.contains(d.id),
                      onChanged: (v) => setState(
                        () => v == true ? _sel.add(d.id) : _sel.remove(d.id),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Sp.lg,
                        vertical: 4,
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                      title: Text(
                        '${d.folio} · ${money(d.balanceCents)}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        '${d.kind.label} · vence ${fullDate(d.dueAt)}${d.overdue(now) ? ' · VENCIDO' : ''}',
                        style: TextStyle(
                          color: d.overdue(now)
                              ? AppColors.error
                              : AppColors.textSecondary,
                        ),
                      ),
                      secondary: alloc == null
                          ? null
                          : Builder(
                              builder: (_) {
                                final a = alloc.applications
                                    .where((x) => x.receivableId == d.id)
                                    .firstOrNull;
                                return a == null
                                    ? const SizedBox.shrink()
                                    : StatusBadge(
                                        'Aplica ${money(a.amountCents)}',
                                        tone: Tone.success,
                                      );
                              },
                            ),
                    ),
                ],
              ),
            const SectionTitle('Forma de pago'),
            ChoiceBar<PaymentMethod>(
              options: const [
                (PaymentMethod.cash, 'Efectivo', Icons.payments),
                (PaymentMethod.transfer, 'Transferencia', Icons.swap_horiz),
                (PaymentMethod.card, 'Tarjeta', Icons.credit_card),
              ],
              selected: _method,
              onSelected: (m) => setState(() => _method = m),
            ),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              onChanged: (_) => setState(() => _amountError = null),
              decoration: InputDecoration(
                labelText: _method == PaymentMethod.cash
                    ? 'Efectivo recibido'
                    : 'Importe del pago',
                prefixText: '\$ ',
                errorText:
                    _amountError ??
                    (_amount.text.isNotEmpty && parseCents(_amount.text) == null
                        ? 'Importe no válido'
                        : null),
                suffixIcon: selectedTotal > 0
                    ? TextButton(
                        onPressed: () => setState(
                          () => _amount.text = centsToInput(selectedTotal),
                        ),
                        child: const Text('Exacto'),
                      )
                    : null,
              ),
            ),
            if (_method != PaymentMethod.cash)
              TextField(
                controller: _ref,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: _method == PaymentMethod.transfer
                      ? 'Referencia o clave de rastreo'
                      : 'Número de autorización (voucher)',
                  helperText:
                      'Se registra como dato informativo; la app no verifica el pago con el banco.',
                ),
              ),
            if (planError != null) InfoBanner(planError, tone: Tone.error),
            if (plan != null)
              StateCard(
                color: AppColors.successBg,
                child: Column(
                  children: [
                    KvRow('Se aplicará', money(plan.appliedCents), bold: true),
                    if (plan.changeCents > 0)
                      KvRow(
                        'Cambio a entregar',
                        money(plan.changeCents),
                        bold: true,
                        vColor: AppColors.success,
                      ),
                    if (selectedTotal - plan.appliedCents > 0)
                      KvRow(
                        'Queda pendiente',
                        money(selectedTotal - plan.appliedCents),
                        vColor: AppColors.warning,
                      ),
                  ],
                ),
              ),
          ],
          footer: PrimaryButton(
            'Registrar cobro',
            icon: Icons.check,
            onPressed: plan == null || !inRoute
                ? null
                : () async {
                    final id = await ref
                        .read(financeRepoProvider)
                        .registerPayment(
                          customerId: widget.customerId!,
                          receivableIds: _sel.toList(),
                          method: _method,
                          enteredCents: entered,
                          reference: _method == PaymentMethod.cash
                              ? ''
                              : _ref.text,
                          actorId: ref.read(sessionProvider).user!.id,
                          idempotencyKey: _key,
                          workdayId: wd!.id,
                        );
                    final p = await ref
                        .read(financeRepoProvider)
                        .paymentById(id);
                    if (!context.mounted) return;
                    final view = await showDialog<bool>(
                      context: context,
                      builder: (d) => AlertDialog(
                        icon: const Icon(
                          Icons.check_circle,
                          color: AppColors.success,
                          size: 48,
                        ),
                        title: Text('Cobro ${p?.folio ?? ''} registrado'),
                        content: Text(
                          [
                            'Aplicado: ${money(p?.amountCents ?? 0)} (${p?.method.label ?? ''})',
                            if ((p?.changeCents ?? 0) > 0)
                              'Cambio: ${money(p!.changeCents)}',
                          ].join('\n'),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(d, false),
                            child: const Text('Listo'),
                          ),
                          TextButton(
                            onPressed: () => Navigator.pop(d, true),
                            child: const Text('Ver comprobante'),
                          ),
                        ],
                      ),
                    );
                    if (!context.mounted) return;
                    if (view == true) {
                      context.pushReplacement('/comprobante/cobro/$id');
                    } else if (context.canPop()) {
                      context.pop();
                    }
                  },
          ),
        );
      },
    );
  }
}
