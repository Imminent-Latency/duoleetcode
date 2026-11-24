import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Standard executable-JAR launcher; all analysis remains in the upstream javacs engine. */
public class BrowserJarLauncher {
    public static native String readInput();
    public static native void writeOutput(String value);
    public static native void writeError(String value);
    public static native void ready(String version, boolean moduleOpen);
    public static void main(String[] args) throws Exception {
        Files.createDirectories(Paths.get("/files/project"));
        Files.write(Paths.get("/files/project/Solution.java"), "class Solution {}".getBytes(StandardCharsets.UTF_8));
        System.setIn(new InputStream() {
            byte[] chunk = new byte[0]; int position;
            public int read() {
                while(position == chunk.length) {chunk=readInput().getBytes(StandardCharsets.UTF_8);position=0;}
                return chunk[position++] & 255;
            }
            public int read(byte[] dst, int off, int len) {
                if(len==0) return 0;
                dst[off]=(byte)read(); int count=1;
                while(count<len && position<chunk.length) dst[off+count++]=chunk[position++];
                return count;
            }
        });
        System.setOut(new PrintStream(new Channel(false),true,"UTF-8"));
        System.setErr(new PrintStream(new Channel(true),true,"UTF-8"));
        Class<?> task=Class.forName("com.sun.tools.javac.api.JavacTaskImpl");
        boolean open=task.getModule().isOpen("com.sun.tools.javac.api",BrowserJarLauncher.class.getModule());
        ready(System.getProperty("java.version"),open);
        if(!open) throw new IllegalStateException("Required compiler package is not open");
        Class.forName("org.javacs.Main").getMethod("main",String[].class).invoke(null,(Object)new String[0]);
    }
    private static class Channel extends OutputStream {
        private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        private final boolean error;
        Channel(boolean error) {this.error=error;}
        public synchronized void write(int value) {bytes.write(value);}
        public synchronized void write(byte[] value,int offset,int count) {bytes.write(value,offset,count);}
        public synchronized void flush() {
            if(bytes.size()==0) return;
            String text=new String(bytes.toByteArray(),StandardCharsets.UTF_8); bytes.reset();
            if(error) writeError(text); else writeOutput(text);
        }
    }
}
