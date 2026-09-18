using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using ChatApp.Models;

namespace ChatApp.Controllers;

public class HomeController : Controller
{
    public IActionResult Index()
    {
        if(User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Chat");
        
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
