import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.ArrayDeque;
import java.util.zip.*;

/** Transport and filesystem adapter only; language intelligence comes from unmodified JDT LS. */
public class BrowserJdtBridge {
    private static final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private static final ByteArrayOutputStream errors = new ByteArrayOutputStream();
    private static final QueueInput input = new QueueInput();
    private static volatile String status = "not started";
    public static String version() { return System.getProperty("java.version") + " / " + System.getProperty("java.home"); }
    public static String status() { return status; }
    public static void startJavacs() throws Exception {
        System.setIn(input);
        System.setOut(new PrintStream(output, true, "UTF-8"));
        System.setErr(new PrintStream(errors, true, "UTF-8"));
        new Thread(() -> {
            try {
                status = "starting javacs";
                Class.forName("org.javacs.Main").getMethod("main", String[].class).invoke(null, (Object) new String[0]);
                status = "javacs returned";
            } catch (Throwable e) { e.printStackTrace(System.err); status = "failed: " + e; }
        }, "browser-javacs").start();
    }
    public static void writeFile(String path, String contents) throws Exception {
        Path file = Paths.get(path); Files.createDirectories(file.getParent());
        Files.write(file, contents.getBytes(StandardCharsets.UTF_8));
    }
    public static String readFile(String path) throws Exception { return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8); }
    public static String prepare(String archive) throws Exception {
        Path root = Paths.get("/files/jdtls"); Files.createDirectories(root);
        int count = 0;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            byte[] buffer = new byte[65536];
            while ((entry = zip.getNextEntry()) != null) {
                Path dest = root.resolve(entry.getName()).normalize();
                if (!dest.startsWith(root)) throw new IOException("Unsafe archive path");
                if (entry.isDirectory()) Files.createDirectories(dest);
                else {
                    Files.createDirectories(dest.getParent());
                    try (OutputStream out = Files.newOutputStream(dest)) {
                        int read; while ((read = zip.read(buffer)) != -1) out.write(buffer, 0, read);
                    }
                }
                status = "extracted " + (++count) + " files";
            }
        }
        Files.createDirectories(Paths.get("/files/project"));
        status = "prepared " + count + " files";
        return status;
    }
    public static void start() throws Exception {
        System.setProperty("eclipse.application", "org.eclipse.jdt.ls.core.id1");
        System.setProperty("eclipse.product", "org.eclipse.jdt.ls.core.product");
        System.setProperty("osgi.bundles.defaultStartLevel", "4");
        System.setProperty("osgi.install.area", "file:/files/jdtls/");
        System.setProperty("osgi.locking", "none");
        System.setProperty("java.awt.headless", "true");
        System.setProperty("log.level", "ALL");
        System.setIn(input);
        System.setOut(new PrintStream(output, true, "UTF-8"));
        System.setErr(new PrintStream(errors, true, "UTF-8"));
        new Thread(() -> {
            try {
                status = "starting Equinox";
                Class<?> launcher = Class.forName("org.eclipse.equinox.launcher.Main");
                Method run = launcher.getMethod("run", String[].class);
                Object code = run.invoke(launcher.getDeclaredConstructor().newInstance(),
                    (Object) new String[]{"-configuration", "/files/jdtls/config_linux", "-data", "/files/workspace", "-consoleLog"});
                status = "Equinox returned " + code;
            } catch (Throwable e) { e.printStackTrace(System.err); status = "failed: " + e; }
        }, "browser-jdtls").start();
    }
    public static void send(String message) throws Exception { input.push(message.getBytes(StandardCharsets.UTF_8)); }
    public static String drainOutput() throws Exception { synchronized(output) { String text = output.toString("UTF-8"); output.reset(); return text; } }
    public static String drainOutputBase64() { synchronized(output) { String text = java.util.Base64.getEncoder().encodeToString(output.toByteArray()); output.reset(); return text; } }
    public static String drainErrors() throws Exception { synchronized(errors) { String text = errors.toString("UTF-8"); errors.reset(); return text; } }
    private static class QueueInput extends InputStream {
        private final ArrayDeque<Byte> bytes = new ArrayDeque<>();
        synchronized void push(byte[] chunk) { for (byte b : chunk) bytes.add(b); notifyAll(); }
        public synchronized int read() throws IOException {
            while (bytes.isEmpty()) try { wait(); } catch (InterruptedException e) { throw new IOException(e); }
            return bytes.remove() & 255;
        }
        public synchronized int read(byte[] buf, int off, int len) throws IOException {
            if (len == 0) return 0;
            buf[off] = (byte) read(); int count = 1;
            while (count < len && !bytes.isEmpty()) buf[off + count++] = bytes.remove();
            return count;
        }
        public synchronized int available() { return bytes.size(); }
    }
}
