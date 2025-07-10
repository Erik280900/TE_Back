const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// CAMBIA ESTE PUERTO POR EL TUYO
const SERIAL_PORT = 'COM5';
const BAUD_RATE = 9600;

console.log('🚀 Iniciando test simple...');
console.log('📍 Puerto:', SERIAL_PORT);

// Crear conexión serial
const port = new SerialPort({
  path: SERIAL_PORT,
  baudRate: BAUD_RATE,
});

// Parser para leer líneas
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// Eventos
port.on('open', () => {
  console.log('✅ Puerto abierto correctamente');
  console.log('💬 Esperando mensajes del Arduino...');
  
  // Enviar comando de prueba cada 5 segundos
  setInterval(() => {
    console.log('📤 Enviando: test');
    port.write('test\n');
  }, 5000);
});

port.on('error', (err) => {
  console.error('❌ Error:', err.message);
  console.log('💡 Verifica que:');
  console.log('   - Arduino esté conectado');
  console.log('   - Puerto COM5 sea correcto');
  console.log('   - Arduino IDE esté cerrado');
});

// Escuchar datos del Arduino
parser.on('data', (data) => {
  console.log('📥 Arduino dice:', data.trim());
});

// Manejar cierre
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando...');
  port.close();
  process.exit();
});

console.log('⌨️  Presiona Ctrl+C para salir');