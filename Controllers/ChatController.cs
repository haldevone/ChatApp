using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ChatApp.Controllers
{
    [Authorize]
    public class ChatController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
