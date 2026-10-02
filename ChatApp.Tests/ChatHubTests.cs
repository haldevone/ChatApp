using ChatApp.Data;
using ChatApp.Models;
using ChatApp.Views.Hubs;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;


namespace ChatApp.Tests;

public class ChatHubTests
{
    private ApplicationDbContext GetInMemoryDb()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new ApplicationDbContext(options);
    }

    private Mock<UserManager<ApplicationUser>> GetMockUserManager()
    {
        var store = new Mock<IUserStore<ApplicationUser>>();
        return new Mock<UserManager<ApplicationUser>>(store.Object, null, null, null, null, null, null, null, null);
    }

    [Fact]
    public async Task NotifyTyping_SendsUserTypingToOthers()
    {
        var db = GetInMemoryDb();
        var userManagerMock = GetMockUserManager();
        var loggerMock = new Mock<ILogger<ChatHub>>();

        var hub = new ChatHub(db, userManagerMock.Object, loggerMock.Object);

        var clientsMock = new Mock<IHubCallerClients>();
        var othersMock = new Mock<IClientProxy>();

        clientsMock
            .Setup(c => c.OthersInGroup("test-rum"))
            .Returns(othersMock.Object);

        hub.Clients = clientsMock.Object;

        var contextMock = new Mock<HubCallerContext>();
        contextMock.Setup(c => c.ConnectionId).Returns("connection-1");

        var identity = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity(
                new[]
                {
                new System.Security.Claims.Claim(
                    System.Security.Claims.ClaimTypes.Name,
                    "TestUser")
                },
                "TestAuth"));

        contextMock.Setup(c => c.User).Returns(identity);

        hub.Context = contextMock.Object;

        await hub.NotifyTyping("test-rum");

        othersMock.Verify(
            c => c.SendCoreAsync(
                "UserTyping",
                It.Is<object[]>(args => args.Length == 1 && (string)args[0] == "TestUser"),
                default),
            Times.Once);
    }


    [Fact]
    public async Task JoinGroup_DeniedForNonMembers()
    {
        var db = GetInMemoryDb();
        db.ChatRooms.Add(new ChatRoom { Id = 1, Name = "privat-rum", OwnerId = "ägare-id" });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var userManagerMock = GetMockUserManager();
        userManagerMock.Setup(u => u.GetUserId(It.IsAny<System.Security.Claims.ClaimsPrincipal>()))
            .Returns("icke-medlem-id");

        var loggerMock = new Mock<ILogger<ChatHub>>();
        var hub = new ChatHub(db, userManagerMock.Object, loggerMock.Object);

        var clientsMock = new Mock<IHubCallerClients>();
        var callerMock = new Mock<ISingleClientProxy>();
        clientsMock.Setup(c => c.Caller).Returns(callerMock.Object);
        hub.Clients = clientsMock.Object;

        var contextMock = new Mock<HubCallerContext>();
        contextMock.Setup(c => c.ConnectionId).Returns("conn-1");
        hub.Context = contextMock.Object;

        await hub.JoinGroup("privat-rum");

        callerMock.Verify(c => c.SendCoreAsync("JoinDenied", It.IsAny<object[]>(), default), Times.Once);
    }

    [Fact]
    public async Task SendMessageToGroup_SaveToDbIfMember()
    {
        var db = GetInMemoryDb();
        var room = new ChatRoom { Id = 1, Name = "test-rum", OwnerId = "user-1" };
        db.ChatRooms.Add(room);
        db.ChatRoomMembers.Add(new ChatRoomMember { ChatRoomId = 1, UserId = "user-1", ChatRoom = room });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var userManagerMock = GetMockUserManager();
        userManagerMock.Setup(u => u.GetUserId(It.IsAny<System.Security.Claims.ClaimsPrincipal>()))
            .Returns("user-1");

        var loggerMock = new Mock<ILogger<ChatHub>>();
        var hub = new ChatHub(db, userManagerMock.Object, loggerMock.Object);

        var clientsMock = new Mock<IHubCallerClients>();
        var groupMock = new Mock<IClientProxy>();
        clientsMock.Setup(c => c.Group(It.IsAny<string>())).Returns(groupMock.Object);
        hub.Clients = clientsMock.Object;

        var contextMock = new Mock<HubCallerContext>();
        var identityMock = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity(new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, "TestUser") }, "TestAuth"));
        contextMock.Setup(c => c.User).Returns(identityMock);
        hub.Context = contextMock.Object;

        await hub.SendMessageToGroup("test-rum", "Hej alla!", "iv-base64");

        var savedMessage = await db.Messages.FirstOrDefaultAsync(TestContext.Current.CancellationToken);
        Assert.NotNull(savedMessage);
        Assert.Equal("Hej alla!", savedMessage!.Text);
    }

    [Fact]
    public async Task SendMessageToGroup_DeniedForLongMessage()
    {
        var db = GetInMemoryDb();
        var userManagerMock = GetMockUserManager();
        var loggerMock = new Mock<ILogger<ChatHub>>();
        var hub = new ChatHub(db, userManagerMock.Object, loggerMock.Object);

        var contextMock = new Mock<HubCallerContext>();
        hub.Context = contextMock.Object;

        var langtMeddelande = new string('x', 2001);

        await hub.SendMessageToGroup("test-rum", langtMeddelande, "iv-base64");

        Assert.Empty(await db.Messages.ToListAsync(TestContext.Current.CancellationToken));
    }

}
