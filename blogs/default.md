# Test
<!-- DATE: 2026-08-15 | TAG: Test -->

```cpp
int main() {
return 0;
}
```
```java
var a = 0;

```

---POST---


# 关于Linux（Debian/Ubuntu）的基础食用指南
<!-- DATE: 2025-08-13 | TAG: Linux -->

对于我们搞程序或者喜欢瞎捣鼓的来说，有一个好用的操作系统、好的编程环境是很重要的。

Debian和Ubuntu系统稳定、安全、易用，网上相关学习参考资料也很多，适合刚刚接触linux的新手，推荐使用;这里更加推荐使用ubuntu,因为更加无脑且一些配置比较简单。

## 一、系统安装

安装过程比较简单，在网上可以找到许多教程，这里简单说一下。

#### 1、系统下载

在windows环境下用浏览器打开[Delian](https://www.debian.org/)或者[Ubuntu](https://ubuntu.com/)的官网，找到download按钮（注意下载桌面版的，这样对于小白来说比较友好，也可以下载无桌面版本的以后再安装桌面），点击即可下载，下载后的文件应为Ubuntu-xxxx-xxxx.iso。（如果下载缓慢请使用魔法或者国内镜像站）

![img](https://ztyou.cn/upload/image.png)

#### 2、制作启动盘

windows下推荐两种方式：一种是刷入u盘，另一种是通过ventoy启动;不过需要注意的是u盘大小需要在8GB以上，**并且两种方式均会使u盘现有数据清空，请注意备份数据**。

刷入u盘：推荐使用[balenaEtcher](https://etcher.balena.io/)刷写，安装好软件之后按照软件说明刷写即可;

![img](https://ztyou.cn/upload/image-eRZv.png)

balenaEtcher官网

ventoy启动：前往[vontoy下载界面](https://www.ventoy.net/cn/download.html)下载，下载后按照官方文档走即可（ventoy启动个人认为更为友好，特别是有多个镜像文件但是只有一个u盘的时候，可以避免多次制作启动盘）。

![img](https://ztyou.cn/upload/image-hMcq.png)

ventoy下载页面

#### 3、安装系统

##### 1.启动启动盘

先去网上搜索你电脑型号对应的进入bios的方式，对于大部分电脑一般是F1,F2或F8。然后插上u盘，重启你的电脑；在看到电脑亮的时候疯狂点按进入bios的按键，进入后到boot选项选取usb启动，如果不会请自行百度或豆包；

##### 2.正式安装

进入ubuntu的启动盘之后，可以先下滑把language换成中文，然后就可以无脑下一步安装了；期间可能会叫你创建账户，设置时区等等，这些操作比较简单，思考一下应该都会。最重要的是关于磁盘的分区和设置（***这可能会损坏你原有的数据，注意备份！！！\***）：

Ubuntu默认的是和windows系统共存，即双系统，选择和windows共存即可；

![img](https://ztyou.cn/upload/Pasted%20image%20(2).png)

还有一种是全盘安装，如果你只有一块硬盘这会删除你的windows系统并且格式化所有数据（假如你还有一块空硬盘的话可以安装到空硬盘上面）；

![img](https://ztyou.cn/upload/Pasted%20image%20(4).png)

以上两种安装方式ubuntu会给你自动完成，几乎不需要操作，还有一种方式是手动分区，这种方式比较高级且容易损失数据，请百度后再操作；

给linux系统分区的大小不需要太大，一般安装后占用可能在10GB或以内，请自行决定需要多少空间。安装快的话会在大概15分钟以内结束，它会提醒你重启，重启后即可使用。（Debian的安装过程类似，但是一些过程却更加复杂，可以自行百度）

## 二、系统使用与优化

由于我使用的是Debian,接下来以Debian演示，ubuntu基本操作相同。

### 1、软件安装

一般来说下载的架构为X86_64,下载后的安装包一般带有xxxxx-xxx-amd64等字样.

Debian类Linux安装软件命令为:



```
sudo dpkg -i xxxxxxx-xxxxxxx-xxxxx.deb
```



#### 1.安装浏览器

推荐使用GoogleChrome浏览器,个人认为比自带的FireFox更好用

从[Google浏览器官网](https://www.google.cn/intl/zh-CN/chrome/)下载,下载后应该为google-chrome-xxxxx.deb



```
sudo dpkg -i google-chrome-xxxxxx.deb
```



#### 2.安装QQ,微信等社交软件

从[QQ官网](https://im.qq.com/linuxqq/index.shtml)/[微信官网](https://linux.weixin.qq.com/)下载Linux安装包,然后同理安装:



```
sudo dpkg -i QQ-xxxxxxx.deb
sudo dpkg -i WeChatLinux-xxx.deb
```



#### 3.安装音乐软件

从[QQ音乐官网](https://y.qq.com/download/download.html)下载安装包,同理安装:



```
sudo dpkg -i qqmusic-xxxxxxx.deb
```



由于Kugou音乐没有Linux版本,可以使用MoeKoeMusic(Github:https://github.com/MoeKoeMusic/MoeKoeMusic),一位大佬开发的一款开源简洁高颜值的酷狗第三方客户端,安装同理:



```
sudo dpkg -i MoeKoe_Music_v1.5.1_amd64.deb
```



如果安装过后MoeKoeMusic打不开的话,一直闪退,请编辑/usr/share/applications/moekoemusic.desktop :



```
sudo apt install vim  \\如果你没有安装过vim的话
sudo vim /usr/share/applications/moekoemusic.desktop
```



在Exec=".............." %U后面加上 --no-sandbox,如下所示



```
[Desktop Entry]
Name=MoeKoe Music
Exec="/opt/MoeKoe Music/moekoemusic" %U --no-sandbox
Terminal=false
Type=Application
Icon=moekoemusic
StartupWMClass=MoeKoe Music
Comment=MoeKoe Music
MimeType=x-scheme-handler/moekoe;
Categories=Utility;
```



如果其他应用闪退则以相同方式添加即可.

#### 4.安装视频软件

这里推荐安装bilibili,但是bilibili官方也没有Linux版本的客户端,所以这里也推荐Github上大佬的bilibili-linux(Github:https://github.com/msojocs/bilibili-linux),功能完善,还有一些bilibili原版客户端没有的功能,安装同理:



```
sudo dpkg -i io.github.msojocs.bilibili_xxxxxx_amd64.deb
```



未完待续........