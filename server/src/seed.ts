import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from './lib.js';

/** Crea el administrador y, en el primer arranque, la Máquina Nº1. Es idempotente. */
const TABLES = ['User', 'Machine', 'CleaningPlan', 'PlanStep', 'CleaningRecord', 'RecordStep', 'Incident', 'MaintenanceLog', 'AuditLog'];

export async function seed(log: (m: string) => void = console.log) {
  // En PostgreSQL/Supabase: bloquear la API pública de Supabase sobre estas tablas (la app no se ve afectada)
  if (/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')) {
    for (const t of TABLES) await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
  }

  const username = (process.env.ADMIN_USERNAME ?? 'froobieadmin').toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    log('⚠ ADMIN_INITIAL_PASSWORD no definida: no se crea el administrador');
    return;
  }

  const admin = await prisma.user.findUnique({ where: { username } });
  const firstBoot = !admin;
  if (!admin) {
    await prisma.user.create({
      data: {
        username,
        email: process.env.ADMIN_EMAIL ?? 'admin@froobie.local',
        fullName: 'Froobie Admin',
        role: 'ADMIN',
        language: 'de',
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    log(`✔ Administrador "${username}" creado`);
  } else {
    log(`• Administrador "${username}" ya existe (contraseña sin cambios)`);
  }

  if (firstBoot && (await prisma.machine.count()) === 0) {
    await prisma.machine.create({
      data: {
        number: 1,
        name: 'Popsicle Machine',
        model: 'PPB 4000 VV',
        serialNumber: '12750',
        manufacturer: 'Bertollo',
        location: 'Produktion',
        photoUrl: '/uploads/machine-1.png',
        qrToken: crypto.randomBytes(12).toString('base64url'),
        plans: {
          create: {
            name: 'Tägliche Reinigung / Daily cleaning / Limpieza diaria',
            weekdays: '1,2,3,4,5',
            strictDays: '5',
            steps: {
              create: [
                ['Maschine ausschalten und vom Strom trennen', 'Switch off and disconnect the machine', 'Apagar y desconectar la máquina'],
                ['Produktreste aus Trichter und Dosierer entfernen', 'Remove product residues from hopper and doser', 'Retirar restos de producto de la tolva y el dosificador'],
                ['Formen und Förderband mit warmem Wasser vorspülen', 'Pre-rinse moulds and conveyor with warm water', 'Preaclarar moldes y cinta con agua tibia'],
                ['Mit Reinigungsmittel reinigen (Konzentration laut Datenblatt)', 'Clean with detergent (concentration as per data sheet)', 'Limpiar con detergente (concentración según ficha técnica)'],
                ['Gründlich mit Trinkwasser nachspülen', 'Rinse thoroughly with potable water', 'Aclarar a fondo con agua potable'],
                ['Kontaktflächen desinfizieren und Einwirkzeit einhalten', 'Disinfect contact surfaces and respect contact time', 'Desinfectar superficies de contacto respetando el tiempo de actuación'],
                ['Außenflächen und Touchscreen abwischen', 'Wipe external surfaces and touchscreen', 'Limpiar superficies exteriores y pantalla táctil'],
                ['Sichtkontrolle: keine Rückstände, kein Fremdkörper', 'Visual check: no residues, no foreign bodies', 'Control visual: sin residuos ni cuerpos extraños'],
              ].map(([textDe, textEn, textEs]) => ({ textDe, textEn, textEs }))
                .concat(
                  [
                    ['FREITAG: Dosierer und Ventile komplett demontieren und einzeln reinigen', 'FRIDAY: Fully dismantle doser and valves and clean each part', 'VIERNES: Desmontar por completo dosificador y válvulas y limpiar cada pieza'],
                    ['FREITAG: Dichtungen auf Verschleiß prüfen und ggf. ersetzen', 'FRIDAY: Check seals for wear and replace if needed', 'VIERNES: Revisar juntas por desgaste y sustituir si es necesario'],
                    ['FREITAG: Rahmen, Rollen und Boden unter der Maschine reinigen', 'FRIDAY: Clean frame, castors and floor under the machine', 'VIERNES: Limpiar bastidor, ruedas y suelo bajo la máquina'],
                    ['FREITAG: Abklatschprobe / ATP-Test durchführen und Ergebnis notieren', 'FRIDAY: Perform swab / ATP test and note the result', 'VIERNES: Realizar test de superficie / ATP y anotar el resultado'],
                  ].map(([textDe, textEn, textEs]) => ({ textDe, textEn, textEs, onlyStrictDays: true })),
                )
                .map((s, i) => ({ ...s, order: i + 1 })),
            },
          },
        },
      },
    });
    log('✔ Máquina Nº1 Popsicle Machine creada con su orden de limpieza');
  }
}

