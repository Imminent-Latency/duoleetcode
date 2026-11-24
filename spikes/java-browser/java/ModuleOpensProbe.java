public class ModuleOpensProbe {
    public static void main(String[] args) throws Exception {
        Class<?> task = Class.forName("com.sun.tools.javac.api.JavacTaskImpl");
        boolean open = task.getModule().isOpen("com.sun.tools.javac.api", ModuleOpensProbe.class.getModule());
        System.out.println("MODULE_OPEN=" + open);
        if (!task.getDeclaredMethod("cleanup").trySetAccessible()) {
            throw new IllegalStateException("Add-Opens manifest was not applied");
        }
    }
}
