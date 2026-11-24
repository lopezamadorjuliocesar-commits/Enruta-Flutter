import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/utils/validators.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/credit_rules.dart';
import '../auth/account_screen.dart';

/// Mi cuenta (negocio): perfil, datos editables, saldo, documentos y pagos.
class ClientAccountScreen extends ConsumerStatefulWidget {
  const ClientAccountScreen({super.key});
  @override
  ConsumerState<ClientAccountScreen> createState() => _ClientAccountState();
}

class _ClientAccountState extends ConsumerState<ClientAccountScreen> {
  bool _showPaid = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final u = s.user;
    final c0 = s.customer;
    if (u == null || c0 == null) return const SizedBox.shrink();
    final c = ref.watch(customerProvider(c0.id)).value ?? c0;
    final usage = ref.watch(creditUsageProvider(c.id)).value;
    final docs = ref.watch(receivablesProvider(c.id)).value ?? const <Receivable>[];
    final payments = (ref.watch(customerPaymentsProvider(c.id)).value ?? const <Payment>[]).where((p) => p.method != PaymentMethod.creditNote).toList();
    final now = DateTime.now();
    final shownDocs = _showPaid ? docs : docs.where((d) => d.balanceCents != 0).toList();
    final balance = usage?.balance ?? 0;
    return EnScaffold(
      title: 'Mi cuenta',
      subtitle: c.name,
      back: false,
      children: [
        ListGroup(children: [
          ListRow(
            leading: CircleAvatar(radius: 22, backgroundColor: AppColors.emeraldSoft, child: Text(u.fullName.characters.first, style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.emerald, fontSize: 18))),
            title: u.fullName,
            subtitle: '@${u.username} · ${u.phone}\n${u.email}',
            meta: u.isDemo ? const StatusBadge('Cuenta de demostración', tone: Tone.warning, icon: Icons.science) : null,
            trailing: const Icon(Icons.edit_outlined, color: AppColors.emerald),
            onTap: () => _editProfile(u),
            chevron: false,
          ),
          ListRow(
            leading: const Icon(Icons.storefront_outlined, color: AppColors.emerald),
            title: c.name,
            subtitle: 'Contacto: ${c.contactName} · ${c.phone}\nDistribuidor: ${s.company?.name ?? ''}',
            trailing: const Icon(Icons.edit_outlined, color: AppColors.emerald),
            onTap: () => _editBusiness(c),
            chevron: false,
          ),
        ]),
        KpiRow([
          KpiCard('Saldo pendiente', money(balance), valueColor: balance > 0 ? AppColors.error : AppColors.success, icon: Icons.account_balance_wallet_outlined),
          KpiCard(
            c.hasCredit ? 'Crédito disponible' : 'Condición',
            c.hasCredit ? money(usage == null ? 0 : availableCredit(limitCents: c.creditLimitCents, balanceCents: usage.balance, openOrdersCents: usage.openOrders)) : 'Contado',
            sub: c.hasCredit ? 'Límite ${money(c.creditLimitCents)} · ${c.paymentTermsDays} días' : 'Pago al recibir',
            icon: Icons.credit_score_outlined,
          ),
        ]),
        SectionTitle('Documentos', trailing: TextButton(onPressed: () => setState(() => _showPaid = !_showPaid), child: Text(_showPaid ? 'Solo pendientes' : 'Ver todos'))),
        if (shownDocs.isEmpty)
          const EmptyState('Cuando tengas facturas o remisiones, aparecerán aquí.', title: 'Sin documentos pendientes', icon: Icons.task_alt)
        else
          ListGroup(children: [
            for (final d in shownDocs)
              ListRow(
                leading: Icon(d.balanceCents == 0 ? Icons.check_circle : (d.overdue(now) ? Icons.warning_amber_rounded : Icons.description_outlined), color: d.balanceCents == 0 ? AppColors.success : (d.overdue(now) ? AppColors.error : AppColors.textSecondary)),
                title: '${d.folio} · ${d.kind.label}',
                subtitle: d.kind == DocumentKind.credit ? 'A tu favor' : 'Importe ${money(d.amountCents)} · vence ${fullDate(d.dueAt)}${d.overdue(now) ? ' · vencido' : ''}',
                trailing: d.balanceCents == 0
                    ? const StatusBadge('Pagado', tone: Tone.success)
                    : Text(money(d.balanceCents), style: const TextStyle(fontWeight: FontWeight.w800, fontFeatures: AppText.tabular)),
                onTap: d.deliveryId == null || d.kind != DocumentKind.delivery ? null : () => context.push('/comprobante/entrega/${d.deliveryId}'),
                chevron: false,
              ),
          ]),
        if (payments.isNotEmpty) ...[
          SectionTitle('Pagos registrados (${payments.length})'),
          ListGroup(children: [
            for (final p in payments.take(20))
              ListRow(
                leading: const Icon(Icons.receipt_outlined, color: AppColors.emerald),
                title: '${p.folio} · ${p.method.label}',
                subtitle: fullDate(p.createdAt),
                trailing: Text(money(p.amountCents), style: const TextStyle(fontWeight: FontWeight.w700, fontFeatures: AppText.tabular)),
                onTap: () => context.push('/comprobante/cobro/${p.id}'),
                chevron: false,
              ),
          ]),
        ],
        SectionTitle('Seguridad y ayuda'),
        ListGroup(children: [
          ListRow(leading: const Icon(Icons.report_problem_outlined, color: AppColors.emerald), title: 'Mis reportes de problemas', onTap: () => context.push('/negocio/incidencias')),
          ListRow(leading: const Icon(Icons.pin_outlined, color: AppColors.emerald), title: 'Cambiar PIN', onTap: () => showChangePinSheet(context, ref)),
          if (AppConfig.devToolsEnabled) ListRow(leading: const Icon(Icons.build_outlined, color: AppColors.emerald), title: 'Herramientas de desarrollo', onTap: () => context.push('/dev')),
        ]),
      ],
      footer: PrimaryButton('Cerrar sesión', icon: Icons.logout, outlined: true, danger: true, onPressed: () async {
        if (await confirmDialog(context, title: 'Cerrar sesión', message: 'Tu carrito y tus pedidos quedan guardados.', confirm: 'Cerrar sesión')) {
          await ref.read(sessionProvider.notifier).logout();
          if (context.mounted) context.go('/login');
        }
      }),
    );
  }

  Future<void> _editProfile(AppUser u) => _form(
        title: 'Mis datos',
        fields: [
          ('Nombre completo', u.fullName, Validators.name, TextInputType.name),
          ('Teléfono', u.phone, Validators.phone, TextInputType.phone),
          ('Correo', u.email, Validators.email, TextInputType.emailAddress),
        ],
        save: (v) async {
          await ref.read(authRepoProvider).updateProfile(u.id, fullName: v[0], phone: v[1], email: v[2]);
          await ref.read(sessionProvider.notifier).refresh();
        },
      );

  Future<void> _editBusiness(Customer c) => _form(
        title: 'Contacto del negocio',
        note: 'El nombre comercial, el crédito y las condiciones los administra tu distribuidor.',
        fields: [
          ('Persona de contacto', c.contactName, Validators.name, TextInputType.name),
          ('Teléfono del negocio', c.phone, Validators.phone, TextInputType.phone),
        ],
        save: (v) => ref.read(catalogRepoProvider).updateCustomerContact(c.id, contactName: v[0], phone: v[1], actorId: ref.read(sessionProvider).user!.id),
      );

  Future<void> _form({
    required String title,
    String? note,
    required List<(String, String, String? Function(String?), TextInputType)> fields,
    required Future<void> Function(List<String>) save,
  }) async {
    final ctrls = [for (final f in fields) TextEditingController(text: f.$2)];
    final key = GlobalKey<FormState>();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) {
        String? error;
        return StatefulBuilder(
          builder: (c, set) => Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.viewInsetsOf(c).bottom + 20),
            child: Form(
              key: key,
              child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: EnScaffold.spaced([
                  Text(title, style: Theme.of(c).textTheme.titleMedium),
                  if (note != null) Text(note, style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
                  for (var i = 0; i < fields.length; i++)
                    TextFormField(controller: ctrls[i], keyboardType: fields[i].$4, decoration: InputDecoration(labelText: fields[i].$1), validator: fields[i].$3),
                  if (error != null) InfoBanner(error!, tone: Tone.error),
                  PrimaryButton('Guardar', onPressed: () async {
                    if (!(key.currentState?.validate() ?? false)) return;
                    try {
                      await save([for (final t in ctrls) t.text]);
                      if (c.mounted) Navigator.pop(c);
                      if (mounted) snack(context, 'Datos actualizados.');
                    } on DomainException catch (e) {
                      set(() => error = e.message);
                    }
                  }),
                ], 12)),
              ),
            ),
          ),
        );
      },
    );
    for (final t in ctrls) {
      t.dispose();
    }
  }
}
